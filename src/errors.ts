/** Codes the SDK raises itself, next to the backend's (`ORDER_NOT_FOUND`, `INVALID_API_KEY`...). */
export const SDK_ERROR = {
    INVALID_CONFIG: 'INVALID_CONFIG',
    SECRET_KEY_IN_BROWSER: 'SECRET_KEY_IN_BROWSER',
    SERVER_ONLY: 'SERVER_ONLY',
    BROWSER_ONLY: 'BROWSER_ONLY',
    NETWORK_ERROR: 'NETWORK_ERROR',
    TIMEOUT: 'TIMEOUT',
    ABORTED: 'ABORTED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    WIDGET_UNAVAILABLE: 'WIDGET_UNAVAILABLE',
    PAYMENT_CLOSED: 'PAYMENT_CLOSED',
} as const;

export class StakPassError extends Error {
    override readonly name = 'StakPassError';

    constructor(
        /** A backend code (`ORDER_NOT_FOUND`, `RATE_LIMIT_EXCEEDED`...) or one of `SDK_ERROR`. */
        readonly code: string,
        /** HTTP status, 0 when no answer came back. */
        readonly status: number,
        message?: string,
        readonly details?: Array<string>,
        /** Seconds to wait, from the `Retry-After` header of a 429. */
        readonly retryAfter?: number,
        readonly requestId?: string,
    ) {
        super(message ?? code);
    }
}

export function isStakPassError(error: unknown): error is StakPassError {
    return error instanceof StakPassError;
}

const HTTP_BAD_REQUEST = 400;

/** The backend puts its code in `message`, or in `error` when `message` is empty (rate limits). */
export function errorFromResponse(
    status: number,
    body: unknown,
    headers: { retryAfter?: string | null; requestId?: string | null },
) {
    let code = `HTTP_${status}`;
    let details: Array<string> | undefined;
    if (body && typeof body === 'object') {
        const { message, error } = body as { message?: unknown; error?: unknown };
        if (Array.isArray(message)) {
            code = SDK_ERROR.VALIDATION_ERROR;
            details = message.filter((item): item is string => typeof item === 'string');
        } else if (typeof message === 'string' && message) {
            code = message;
        } else if (typeof error === 'string' && error) {
            code = error;
        }
    }
    const retryAfter = Number(headers.retryAfter);

    return new StakPassError(
        code,
        status >= HTTP_BAD_REQUEST ? status : 0,
        undefined,
        details,
        Number.isFinite(retryAfter) && headers.retryAfter ? retryAfter : undefined,
        headers.requestId ?? undefined,
    );
}
