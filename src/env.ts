export const PUBLISHABLE_KEY_PREFIX = 'spk_pub_';
export const SECRET_KEY_PREFIX = 'spk_live_';

/** True in a page, false in Node and edge runtimes. */
export function isBrowser() {
    const scope = globalThis as { window?: unknown; document?: unknown };

    return scope.window !== undefined && scope.document !== undefined;
}

/** `sessionStorage` or `localStorage`, or undefined when blocked (private mode, sandboxed frame). */
export function safeStorage(kind: 'sessionStorage' | 'localStorage'): Storage | undefined {
    // Node 26 prints a warning when `localStorage` is read: only look in a page.
    if (!isBrowser()) {
        return undefined;
    }
    try {
        const storage = (globalThis as Record<string, unknown>)[kind] as Storage | undefined;
        if (!storage) {
            return undefined;
        }
        const probe = '__stakpass__';
        storage.setItem(probe, '1');
        storage.removeItem(probe);

        return storage;
    } catch {
        return undefined;
    }
}

const HEX_RADIX = 16;
const RANDOM_BYTES = 16;

/** 32 hex characters; uses the Web Crypto random source whenever it exists. */
export function randomId() {
    const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
    const bytes = new Uint8Array(RANDOM_BYTES);
    if (webCrypto?.getRandomValues) {
        webCrypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index++) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }

    return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(2, '0')).join('');
}

export function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
