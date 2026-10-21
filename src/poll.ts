import { sleep } from './env';
import { SDK_ERROR, StakPassError } from './errors';

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const BACKOFF_FACTOR = 1.5;
const REQUEST_TIMEOUT_STATUS = 408;
const TOO_MANY_REQUESTS = 429;
const CLIENT_ERROR_MIN = 400;
const SERVER_ERROR_MIN = 500;

export interface Watch<T> {
    /** Stops polling; `done` then rejects with `ABORTED`. */
    stop(): void;
    /** Resolves with the first value `isDone` accepts. */
    done: Promise<T>;
}

export interface PollConfig<T> {
    read: (signal: AbortSignal) => Promise<T>;
    isDone: (value: T) => boolean;
    /** Called when `changeKey(value)` differs from the previous poll. */
    onChange?: (value: T) => void;
    changeKey?: (value: T) => string;
    intervalMs?: number;
    maxIntervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
}

/** A 4xx other than 408/429 will not heal by itself: stop. Network errors and 5xx are retried. */
function isFatal(error: unknown) {
    if (!(error instanceof StakPassError)) {
        return true;
    }
    if (error.code === SDK_ERROR.ABORTED) {
        return true;
    }

    return (
        error.status >= CLIENT_ERROR_MIN &&
        error.status < SERVER_ERROR_MIN &&
        error.status !== REQUEST_TIMEOUT_STATUS &&
        error.status !== TOO_MANY_REQUESTS
    );
}

export function startPolling<T>(config: PollConfig<T>): Watch<T> {
    const controller = new AbortController();
    config.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    const abortedError = () => new StakPassError(SDK_ERROR.ABORTED, 0, 'Polling was stopped');

    const run = async () => {
        const maxInterval = config.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
        const deadline = Date.now() + (config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        let interval = config.intervalMs ?? DEFAULT_INTERVAL_MS;
        let previousKey: string | undefined;

        while (!controller.signal.aborted) {
            try {
                const value = await config.read(controller.signal);
                const key = config.changeKey?.(value);
                if (config.onChange && key !== previousKey) {
                    config.onChange(value);
                }
                previousKey = key;
                if (config.isDone(value)) {
                    return value;
                }
            } catch (error) {
                if (controller.signal.aborted) {
                    break;
                }
                if (isFatal(error)) {
                    throw error;
                }
            }
            if (Date.now() + interval > deadline) {
                throw new StakPassError(SDK_ERROR.TIMEOUT, 0, 'Gave up waiting');
            }
            await sleep(interval, controller.signal).catch(() => undefined);
            interval = Math.min(interval * BACKOFF_FACTOR, maxInterval);
        }

        throw abortedError();
    };

    const done = run();
    // `stop()` alone must not raise an unhandled rejection.
    done.catch(() => undefined);

    return { stop: () => controller.abort(), done };
}
