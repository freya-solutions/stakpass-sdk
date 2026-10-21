import { afterEach, describe, expect, it, vi } from 'vitest';
import { StakPass } from '../src';
import { fakeFetch, ORDER, PUBLISHABLE, pretendBrowser } from './helpers';

const metadata = {
    amount: 5000,
    publicKey: 'kkia_pub',
    sandbox: true,
    reason: 'Tickets',
    stateData: { orderId: 'order_1' },
};

/** A page whose script tag "loads" the widget at once; `outcome` decides how a payment ends. */
function pageWithWidget(outcome: 'success' | 'closed') {
    const scope = globalThis as Record<string, unknown>;
    const listeners: Record<string, (arg?: unknown) => void> = {};
    const open = vi.fn(() => {
        if (outcome === 'success') {
            listeners.success?.({ transactionId: 'tx_1' });
        } else {
            listeners.close?.();
        }
    });
    const script: { src?: string; onload?: () => void; onerror?: () => void } = {};
    const restore = pretendBrowser({
        createElement: () => script,
        head: {
            append: () => {
                scope.openKkiapayWidget = open;
                scope.addSuccessListener = (listener: () => void) => (listeners.success = listener);
                scope.addFailedListener = (listener: () => void) => (listeners.failed = listener);
                scope.addKkiapayCloseListener = (listener: () => void) =>
                    (listeners.close = listener);
                script.onload?.();
            },
        },
    });

    return { open, script, restore };
}

/** The widget loader caches the script per page: each test gets a fresh page. */
async function freshBrowserModule() {
    vi.resetModules();

    return import('../src/browser');
}

describe('Kkiapay widget', () => {
    let restore: (() => void) | undefined;
    afterEach(() => {
        restore?.();
        for (const name of [
            'openKkiapayWidget',
            'addSuccessListener',
            'addFailedListener',
            'addKkiapayCloseListener',
        ]) {
            delete (globalThis as Record<string, unknown>)[name];
        }
    });

    it('opens the widget with the payment parameters and the buyer', async () => {
        const page = pageWithWidget('success');
        restore = page.restore;
        const { payWithKkiapay } = await freshBrowserModule();
        const result = await payWithKkiapay(metadata, {
            buyer: { email: 'a@b.co', name: 'Ada' },
        });
        expect(result).toEqual({ transactionId: 'tx_1' });
        expect(page.script.src).toBe('https://cdn.kkiapay.me/k.js');
        expect(page.open).toHaveBeenCalledWith({
            amount: 5000,
            key: 'kkia_pub',
            sandbox: true,
            reason: 'Tickets',
            data: { orderId: 'order_1' },
            email: 'a@b.co',
            fullname: 'Ada',
        });
    });

    it('rejects when the buyer closes the widget', async () => {
        const page = pageWithWidget('closed');
        restore = page.restore;
        const { payWithKkiapay } = await freshBrowserModule();
        await expect(payWithKkiapay(metadata)).rejects.toMatchObject({ code: 'PAYMENT_CLOSED' });
    });

    it('needs a page', async () => {
        const { payWithKkiapay } = await freshBrowserModule();
        await expect(payWithKkiapay(metadata)).rejects.toMatchObject({ code: 'BROWSER_ONLY' });
    });

    it('checkout pays, then waits until the backend sees the order paid', async () => {
        const page = pageWithWidget('success');
        restore = page.restore;
        const { checkout } = await freshBrowserModule();
        const { fetch, calls } = fakeFetch(
            { status: 201, body: { ...ORDER, accessToken: 'tok' } },
            { body: { provider: 'KKIAPAY', metadata } },
            { body: { ...ORDER, status: 'PENDING' } },
            { body: { ...ORDER, status: 'PAID' } },
        );
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, autoTrackView: false });
        const order = await sp.orders.create({ buyer: { email: 'a@b.co' } });
        const paid = await checkout(sp, order.id, {
            provider: 'KKIAPAY',
            buyer: { email: 'a@b.co' },
            intervalMs: 1,
            maxIntervalMs: 2,
        });
        expect(paid.status).toBe('PAID');
        expect(calls[1]?.url).toContain('/orders/order_1/initiate-payment');
        expect(calls[1]?.init.headers['X-Order-Token']).toBe('tok');
    });

    it('redirects to Stripe', async () => {
        const { redirectToStripe } = await freshBrowserModule();
        const assign = vi.fn();
        restore = pretendBrowser();
        (globalThis as Record<string, unknown>).location = { assign };
        redirectToStripe({ url: 'https://checkout.stripe.com/x', sessionId: 's' });
        expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/x');
        delete (globalThis as Record<string, unknown>).location;
    });
});
