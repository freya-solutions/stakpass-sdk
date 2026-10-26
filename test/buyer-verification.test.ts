import { describe, expect, it } from 'vitest';
import { StakPass } from '../src';
import { fakeFetch, ORDER, PUBLISHABLE, SECRET } from './helpers';

const buyer = { email: 'Awa@Example.com', name: 'Awa' };
const quiet = { autoTrackView: false, maxRetries: 0 };
const verified = {
    verificationToken: 'n3k_token',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
};

describe('buyer verification', () => {
    it('starts with a normalized email', async () => {
        const { fetch, calls } = fakeFetch({ body: { ok: true } });
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...quiet });
        await expect(sp.buyerVerification.start('  Awa@Example.com ')).resolves.toEqual({
            ok: true,
        });
        expect(calls[0]?.url).toBe(
            'https://api.stakpass.com/core/partner/v1/buyer-verification/start',
        );
        expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ email: 'awa@example.com' });
    });

    it('sends the held token with the order, once', async () => {
        const { fetch, calls } = fakeFetch(
            { body: verified },
            { status: 201, body: ORDER },
            { status: 201, body: ORDER },
        );
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await sp.buyerVerification.confirm(buyer.email, '123456');
        expect(sp.buyerVerification.isVerified('awa@example.com')).toBe(true);
        await sp.orders.create({ buyer });
        expect(JSON.parse(String(calls[1]?.init.body)).buyer).toMatchObject({
            email: buyer.email,
            verificationToken: 'n3k_token',
        });
        expect(sp.buyerVerification.isVerified(buyer.email)).toBe(false);
        await sp.orders.create({ buyer });
        expect(JSON.parse(String(calls[2]?.init.body)).buyer.verificationToken).toBeUndefined();
    });

    it('keeps the token when the order fails for another reason', async () => {
        const { fetch } = fakeFetch(
            { body: verified },
            { status: 409, body: { statusCode: 409, message: 'INSUFFICIENT_STOCK' } },
        );
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await sp.buyerVerification.confirm(buyer.email, '123456');
        await expect(sp.orders.create({ buyer })).rejects.toMatchObject({
            code: 'INSUFFICIENT_STOCK',
        });
        expect(sp.buyerVerification.isVerified(buyer.email)).toBe(true);
    });

    it('drops the token on BUYER_VERIFICATION_INVALID', async () => {
        const { fetch } = fakeFetch(
            { body: verified },
            { status: 403, body: { statusCode: 403, message: 'BUYER_VERIFICATION_INVALID' } },
        );
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await sp.buyerVerification.confirm(buyer.email, '123456');
        await expect(sp.orders.create({ buyer })).rejects.toMatchObject({
            code: 'BUYER_VERIFICATION_INVALID',
        });
        expect(sp.buyerVerification.isVerified(buyer.email)).toBe(false);
    });

    it('ignores an expired token', async () => {
        const { fetch } = fakeFetch({
            body: { verificationToken: 't', expiresAt: new Date(Date.now() - 1000).toISOString() },
        });
        const sp = StakPass.init({ secretKey: SECRET, fetch, ...quiet });
        await sp.buyerVerification.confirm(buyer.email, '123456');
        expect(sp.buyerVerification.isVerified(buyer.email)).toBe(false);
    });
});
