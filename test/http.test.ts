import { describe, expect, it } from 'vitest';
import { StakPass } from '../src';
import { fakeFetch, PUBLISHABLE, SECRET } from './helpers';

const options = { autoTrackView: false, maxRetries: 2 };

describe('requests', () => {
    it('sends the key in a header, never with cookies', async () => {
        const { fetch, calls } = fakeFetch({ body: { id: 'event_1' } });
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...options });
        await sp.event.get();
        expect(calls[0]?.url).toBe('https://api.stakpass.com/core/partner/v1/event');
        expect(calls[0]?.init.headers['X-Api-Key']).toBe(PUBLISHABLE);
        expect(calls[0]?.init.credentials).toBe('omit');
    });

    it('honours baseUrl and drops its trailing slash', async () => {
        const { fetch, calls } = fakeFetch({ body: [] });
        const sp = StakPass.init({ secretKey: SECRET, fetch, baseUrl: 'http://localhost:3000/' });
        await sp.tickets.list();
        expect(calls[0]?.url).toBe('http://localhost:3000/core/partner/v1/tickets');
    });

    it('maps a backend error to its code', async () => {
        const { fetch } = fakeFetch({
            status: 404,
            body: { statusCode: 404, message: 'ORDER_NOT_FOUND', error: 'Not Found' },
            headers: { 'x-request-id': 'req_1' },
        });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...options });
        await expect(sp.orders.get('o')).rejects.toMatchObject({
            code: 'ORDER_NOT_FOUND',
            status: 404,
            requestId: 'req_1',
        });
    });

    it('reads a validation error as VALIDATION_ERROR with its details', async () => {
        const { fetch } = fakeFetch({
            status: 400,
            body: { statusCode: 400, message: ['buyer.email must be an email'] },
        });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...options });
        await expect(sp.orders.create({ buyer: { email: 'x' } })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            details: ['buyer.email must be an email'],
        });
    });

    it('reads the rate-limit code from `error` when `message` is empty', async () => {
        const { fetch } = fakeFetch({
            status: 429,
            body: { statusCode: 429, message: null, error: 'RATE_LIMIT_EXCEEDED' },
            headers: { 'retry-after': '60' },
        });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...options });
        // 60 s is longer than the SDK waits: it fails at once, without retrying.
        await expect(sp.event.get()).rejects.toMatchObject({
            code: 'RATE_LIMIT_EXCEEDED',
            status: 429,
            retryAfter: 60,
        });
    });
});

describe('retries', () => {
    it('retries a 429 that asks for a short wait, even on a POST', async () => {
        const { fetch, calls } = fakeFetch(
            {
                status: 429,
                body: { message: null, error: 'RATE_LIMIT_EXCEEDED' },
                headers: { 'retry-after': '0' },
            },
            { body: { recorded: true } },
        );
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...options });
        await expect(sp.track.share('LINK')).resolves.toEqual({ recorded: true });
        expect(calls).toHaveLength(2);
    });

    it('retries a GET after a network error', async () => {
        const { fetch, calls } = fakeFetch(new TypeError('offline'), { body: [] });
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...options });
        await expect(sp.tickets.list()).resolves.toEqual([]);
        expect(calls).toHaveLength(2);
    });

    it('does not resend an order a browser key may already have created', async () => {
        const { fetch, calls } = fakeFetch(new TypeError('offline'));
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...options });
        await expect(sp.orders.create({ buyer: { email: 'a@b.co' } })).rejects.toMatchObject({
            code: 'NETWORK_ERROR',
        });
        expect(calls).toHaveLength(1);
    });

    it('gives up after maxRetries', async () => {
        const { fetch, calls } = fakeFetch(new TypeError('offline'));
        const sp = StakPass.init({
            publishableKey: PUBLISHABLE,
            fetch,
            autoTrackView: false,
            maxRetries: 1,
        });
        await expect(sp.event.get()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
        expect(calls).toHaveLength(2);
    });

    it('times out', async () => {
        const slow = ((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            })) as unknown as typeof fetch;
        const sp = StakPass.init({
            secretKey: SECRET,
            fetch: slow,
            timeoutMs: 10,
            maxRetries: 0,
        });
        await expect(sp.event.get()).rejects.toMatchObject({ code: 'TIMEOUT' });
    });

    it('aborts on the caller signal', async () => {
        const controller = new AbortController();
        const slow = ((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            })) as unknown as typeof fetch;
        const sp = StakPass.init({ secretKey: SECRET, fetch: slow, maxRetries: 0 });
        const pending = sp.event.get({ signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    });
});
