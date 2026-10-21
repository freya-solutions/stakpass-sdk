import { vi } from 'vitest';

export type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

export type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

/** A fetch that answers from a queue and records every call. */
export function fakeFetch(...replies: Array<Reply>) {
    const calls: Array<Call> = [];
    const queue = [...replies];
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init as Call['init'] });
        const reply = queue.length > 1 ? queue.shift() : queue[0];
        if (reply instanceof Error) {
            throw reply;
        }
        const status = reply?.status ?? 200;

        return new Response(reply?.body === undefined ? '' : JSON.stringify(reply.body), {
            status,
            headers: reply?.headers,
        });
    });

    return { fetch: impl as unknown as typeof fetch, calls };
}

export const PUBLISHABLE = 'spk_pub_test';
export const SECRET = 'spk_live_test';

export const ORDER = {
    id: 'order_1',
    status: 'INIT',
    amount: 5000,
    currency: 'XOF',
    paymentProvider: null,
    buyerEmail: 'a@b.co',
    paidAt: null,
    createdAt: '2026-10-21T00:00:00.000Z',
    items: [],
};

/** Pretends the code runs in a page, as `isBrowser` sees it. */
export function pretendBrowser(extra: Record<string, unknown> = {}) {
    const scope = globalThis as Record<string, unknown>;
    scope.window = {};
    scope.document = { referrer: '', ...extra };

    return () => {
        scope.window = undefined;
        scope.document = undefined;
    };
}
