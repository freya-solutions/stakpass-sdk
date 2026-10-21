import { describe, expect, it } from 'vitest';
import { parsePaymentReturn, StakPass } from '../src';
import { fakeFetch, ORDER, PUBLISHABLE, SECRET } from './helpers';

const buyer = { email: 'a@b.co', name: 'Ada' };
const quiet = { autoTrackView: false, maxRetries: 2 };

describe('orders with a secret key', () => {
    it('sends an idempotency key and keeps it across a retry', async () => {
        const { fetch, calls } = fakeFetch(new TypeError('offline'), { status: 201, body: ORDER });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await sp.orders.create({ buyer, tickets: [{ ticketId: 't1', quantity: 2 }] });
        expect(calls).toHaveLength(2);
        const first = calls[0]?.init.headers['Idempotency-Key'];
        expect(first).toMatch(/^sp_[0-9a-f]{32}$/);
        expect(calls[1]?.init.headers['Idempotency-Key']).toBe(first);
        expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
            buyer,
            tickets: [{ ticketId: 't1', quantity: 2 }],
            packs: [],
        });
    });

    it('lets the caller pick the idempotency key', async () => {
        const { fetch, calls } = fakeFetch({ status: 201, body: ORDER });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await sp.orders.create({ buyer }, { idempotencyKey: 'my-order-0001' });
        expect(calls[0]?.init.headers['Idempotency-Key']).toBe('my-order-0001');
    });

    it('never sends an order token', async () => {
        const { fetch, calls } = fakeFetch({ body: ORDER });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await sp.orders.get('order_1', { orderToken: 'ignored' });
        expect(calls[0]?.init.headers['X-Order-Token']).toBeUndefined();
    });

    it('lists orders with a filter', async () => {
        const { fetch, calls } = fakeFetch({ body: { data: [ORDER], total: 1 } });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await expect(sp.orders.list({ status: 'PAID', page: 2 })).resolves.toMatchObject({
            total: 1,
        });
        expect(calls[0]?.url).toBe(
            'https://api.stakpass.com/core/partner/v1/orders?status=PAID&page=2',
        );
    });
});

describe('orders with a publishable key', () => {
    it('keeps the access token once and sends it on every later call', async () => {
        const { fetch, calls } = fakeFetch(
            { status: 201, body: { ...ORDER, accessToken: 'tok_secret' } },
            { body: ORDER },
            { body: { provider: 'STRIPE', metadata: { url: 'https://stripe', sessionId: 's' } } },
            { body: [] },
        );
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...quiet });
        const order = await sp.orders.create({ buyer });
        expect(calls[0]?.init.headers['Idempotency-Key']).toBeUndefined();
        expect(calls[0]?.init.headers['X-Order-Token']).toBeUndefined();

        await sp.orders.get(order.id);
        await sp.orders.pay(order.id, {
            provider: 'STRIPE',
            returnUrl: 'https://shop.example/done',
        });
        await sp.orders.tickets(order.id);
        for (const call of calls.slice(1)) {
            expect(call.init.headers['X-Order-Token']).toBe('tok_secret');
        }
        expect(JSON.parse(String(calls[2]?.init.body))).toEqual({
            provider: 'STRIPE',
            returnUrl: 'https://shop.example/done',
        });
    });

    it('lets the caller pass a token it holds', async () => {
        const { fetch, calls } = fakeFetch({ body: ORDER });
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...quiet });
        await sp.orders.get('order_9', { orderToken: 'tok_other' });
        expect(calls[0]?.init.headers['X-Order-Token']).toBe('tok_other');
    });

    it('cannot list orders', () => {
        const { fetch, calls } = fakeFetch({});
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...quiet });
        expect(() => sp.orders.list()).toThrowError(
            expect.objectContaining({ code: 'SERVER_ONLY' }),
        );
        expect(calls).toHaveLength(0);
    });
});

describe('waiting for an order', () => {
    const fast = { intervalMs: 1, maxIntervalMs: 2 };

    it('reports each status change and resolves on PAID', async () => {
        const { fetch } = fakeFetch(
            { body: { ...ORDER, status: 'INIT' } },
            { body: { ...ORDER, status: 'INIT' } },
            { body: { ...ORDER, status: 'PENDING' } },
            { body: { ...ORDER, status: 'PAID' } },
        );
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        const seen: Array<string> = [];
        const order = await sp.orders.watch('order_1', (next) => seen.push(next.status), fast).done;
        expect(order.status).toBe('PAID');
        expect(seen).toEqual(['INIT', 'PENDING', 'PAID']);
    });

    it('keeps going through a network error but stops on a 404', async () => {
        const ok = fakeFetch(new TypeError('offline'), { body: { ...ORDER, status: 'PAID' } });
        const sp = StakPass.init({ secretKey: SECRET, fetch: ok.fetch, maxRetries: 0 });
        await expect(sp.orders.waitForPayment('order_1', fast)).resolves.toMatchObject({
            status: 'PAID',
        });

        const gone = fakeFetch({ status: 404, body: { message: 'ORDER_NOT_FOUND' } });
        const other = StakPass.init({ secretKey: SECRET, fetch: gone.fetch, maxRetries: 0 });
        await expect(other.orders.waitForPayment('x', fast)).rejects.toMatchObject({
            code: 'ORDER_NOT_FOUND',
        });
    });

    it('can be stopped', async () => {
        const { fetch } = fakeFetch({ body: ORDER });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        const watch = sp.orders.watch('order_1', undefined, fast);
        watch.stop();
        await expect(watch.done).rejects.toMatchObject({ code: 'ABORTED' });
    });

    it('gives up after the timeout', async () => {
        const { fetch } = fakeFetch({ body: ORDER });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await expect(
            sp.orders.waitForPayment('order_1', { ...fast, timeoutMs: 20 }),
        ).rejects.toMatchObject({
            code: 'TIMEOUT',
        });
    });

    it('waits for the tickets of a paid order', async () => {
        const ticket = {
            id: 'ut_1',
            code: 'ABC',
            status: 'UNVERIFIED',
            ticketId: 't1',
            orderId: 'order_1',
        };
        const { fetch } = fakeFetch({ body: [] }, { body: [ticket] });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await expect(sp.orders.waitForTickets('order_1', fast)).resolves.toEqual([ticket]);
    });
});

describe('parsePaymentReturn', () => {
    it('reads the query Stripe sends the buyer back with', () => {
        expect(parsePaymentReturn('?orderId=o1&payment=success')).toEqual({
            orderId: 'o1',
            payment: 'success',
        });
        expect(
            parsePaymentReturn('https://shop.example/done?x=1&orderId=o2&payment=cancelled'),
        ).toEqual({
            orderId: 'o2',
            payment: 'cancelled',
        });
        expect(parsePaymentReturn(new URLSearchParams('orderId=o3&payment=success'))).toMatchObject(
            {
                orderId: 'o3',
            },
        );
    });

    it('returns nothing for any other query', () => {
        expect(parsePaymentReturn('?orderId=o1')).toBeUndefined();
        expect(parsePaymentReturn('?orderId=o1&payment=maybe')).toBeUndefined();
        expect(parsePaymentReturn('')).toBeUndefined();
    });
});
