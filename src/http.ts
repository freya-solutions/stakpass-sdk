import { sleep } from './env';
import { errorFromResponse, SDK_ERROR, StakPassError } from './errors';

const RETRY_BASE_DELAY_MS = 300;
/** A 429 asking for a longer wait than this fails at once instead of freezing the caller. */
const MAX_RETRY_AFTER_SECONDS = 10;
const MS_PER_SECOND = 1000;
const SERVICE_UNAVAILABLE_STATUSES = [502, 503, 504];
const TOO_MANY_REQUESTS = 429;

export interface HttpConfig {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    maxRetries: number;
    fetch: typeof fetch;
}

export interface HttpRequest {
    method?: 'GET' | 'POST';
    path: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    headers?: Record<string, string | undefined>;
    signal?: AbortSignal;
    /** False for a call that is not safe to send twice. A 429 is still retried: nothing ran. */
    retryable?: boolean;
}

export class HttpClient {
    constructor(private readonly config: HttpConfig) {}

    async request<T>(request: HttpRequest): Promise<T> {
        const method = request.method ?? 'GET';
        const canRetryFailures = method === 'GET' || request.retryable === true;
        let attempt = 0;

        while (true) {
            try {
                return await this.send<T>(request, method);
            } catch (error) {
                const wait = this.retryDelay(error, attempt, canRetryFailures);
                if (wait === undefined || request.signal?.aborted) {
                    throw error;
                }
                attempt++;
                await sleep(wait, request.signal).catch(() => {
                    throw error;
                });
            }
        }
    }

    private retryDelay(error: unknown, attempt: number, canRetryFailures: boolean) {
        if (attempt >= this.config.maxRetries || !(error instanceof StakPassError)) {
            return undefined;
        }
        if (error.status === TOO_MANY_REQUESTS) {
            const seconds = error.retryAfter ?? 1;

            return seconds > MAX_RETRY_AFTER_SECONDS ? undefined : seconds * MS_PER_SECOND;
        }
        const transient =
            error.code === SDK_ERROR.NETWORK_ERROR ||
            SERVICE_UNAVAILABLE_STATUSES.includes(error.status);
        if (!(transient && canRetryFailures)) {
            return undefined;
        }

        return RETRY_BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * RETRY_BASE_DELAY_MS);
    }

    private async send<T>(request: HttpRequest, method: string): Promise<T> {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, this.config.timeoutMs);
        const onCallerAbort = () => controller.abort();
        request.signal?.addEventListener('abort', onCallerAbort, { once: true });
        if (request.signal?.aborted) {
            controller.abort();
        }

        const headers: Record<string, string> = {
            Accept: 'application/json',
            'X-Api-Key': this.config.apiKey,
        };
        if (request.body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        for (const [name, value] of Object.entries(request.headers ?? {})) {
            if (value !== undefined) {
                headers[name] = value;
            }
        }

        let response: Response;
        try {
            response = await this.config.fetch(this.url(request), {
                method,
                headers,
                body: request.body === undefined ? undefined : JSON.stringify(request.body),
                signal: controller.signal,
                // The key travels in a header; a visitor's cookies must never reach the API.
                credentials: 'omit',
            });
        } catch (cause) {
            if (timedOut) {
                throw new StakPassError(SDK_ERROR.TIMEOUT, 0, 'The request timed out');
            }
            if (request.signal?.aborted) {
                throw new StakPassError(SDK_ERROR.ABORTED, 0, 'The request was aborted');
            }
            throw new StakPassError(
                SDK_ERROR.NETWORK_ERROR,
                0,
                cause instanceof Error ? cause.message : 'Network error',
            );
        } finally {
            clearTimeout(timer);
            request.signal?.removeEventListener('abort', onCallerAbort);
        }

        const body = await this.readBody(response);
        if (!response.ok) {
            throw errorFromResponse(response.status, body, {
                retryAfter: response.headers.get('retry-after'),
                requestId: response.headers.get('x-request-id'),
            });
        }

        return body as T;
    }

    private async readBody(response: Response): Promise<unknown> {
        const text = await response.text().catch(() => '');
        if (!text) {
            return undefined;
        }
        try {
            return JSON.parse(text);
        } catch {
            return undefined;
        }
    }

    private url(request: HttpRequest) {
        const url = new URL(`${this.config.baseUrl}/core/partner/v1/${request.path}`);
        for (const [name, value] of Object.entries(request.query ?? {})) {
            if (value !== undefined) {
                url.searchParams.set(name, String(value));
            }
        }

        return url.toString();
    }
}
