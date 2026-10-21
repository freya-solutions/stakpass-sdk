import type { StakPass } from './client';
import { isBrowser } from './env';
import { SDK_ERROR, StakPassError } from './errors';
import type {
    Buyer,
    kkiapayMetadata,
    PartnerOrder,
    PaymentInitiation,
    PollOptions,
    StripeMetadata,
} from './types';

export * from './index';

const KKIAPAY_SCRIPT = 'https://cdn.kkiapay.me/k.js';

interface kkiapayGlobals {
    openkkiapayWidget(options: Record<string, unknown>): void;
    addSuccessListener(listener: (response: { transactionId?: string }) => void): void;
    addFailedListener(listener: (response?: unknown) => void): void;
    addkkiapayCloseListener(listener: () => void): void;
}

type kkiapayHandlers = {
    success: (response: { transactionId?: string }) => void;
    failed: () => void;
    close: () => void;
};

let widgetLoading: Promise<kkiapayGlobals> | undefined;
let handlers: kkiapayHandlers | undefined;

function widgetGlobals() {
    return globalThis as unknown as Partial<kkiapayGlobals>;
}

function loadkkiapay(): Promise<kkiapayGlobals> {
    if (!isBrowser()) {
        return Promise.reject(
            new StakPassError(SDK_ERROR.BROWSER_ONLY, 0, 'The payment widget runs in a page only'),
        );
    }
    widgetLoading ??= new Promise<kkiapayGlobals>((resolve, reject) => {
        const ready = () => {
            const globals = widgetGlobals();
            if (
                globals.openkkiapayWidget &&
                globals.addSuccessListener &&
                globals.addFailedListener &&
                globals.addkkiapayCloseListener
            ) {
                // The widget keeps every listener it is given: register once, dispatch to the
                // payment in progress.
                globals.addSuccessListener((response) => handlers?.success(response));
                globals.addFailedListener(() => handlers?.failed());
                globals.addkkiapayCloseListener(() => handlers?.close());
                resolve(globals as kkiapayGlobals);
                return;
            }
            reject(
                new StakPassError(
                    SDK_ERROR.WIDGET_UNAVAILABLE,
                    0,
                    'The payment widget failed to load',
                ),
            );
        };
        const script = document.createElement('script');
        script.src = KKIAPAY_SCRIPT;
        script.async = true;
        script.onload = ready;
        script.onerror = () => {
            reject(
                new StakPassError(
                    SDK_ERROR.WIDGET_UNAVAILABLE,
                    0,
                    `Could not load ${KKIAPAY_SCRIPT}. Check your Content-Security-Policy and network.`,
                ),
            );
        };
        document.head.append(script);
    });
    // A failed load can be retried by the next payment.
    widgetLoading.catch(() => {
        widgetLoading = undefined;
    });

    return widgetLoading;
}

export interface kkiapayResult {
    transactionId?: string;
}

/**
 * Opens the kkiapay widget for a `KKIAPAY` initiation. Resolves when the buyer pays. Rejects with
 * `PAYMENT_CLOSED` when the widget is closed or the payment fails. A paid widget does not mean a
 * paid order: confirm with `orders.waitForPayment`, which `checkout` does.
 * The page's Content-Security-Policy must allow `https://cdn.kkiapay.me` and kkiapay's frames.
 */
export async function payWithkkiapay(
    metadata: kkiapayMetadata,
    options: { buyer?: Buyer; theme?: string } = {},
): Promise<kkiapayResult> {
    const widget = await loadkkiapay();
    // The widget stringifies keys that are present but undefined.
    const widgetOptions = Object.fromEntries(
        Object.entries({
            email: options.buyer?.email,
            fullname: options.buyer?.name,
            phone: options.buyer?.phone,
            theme: options.theme,
        }).filter(([, value]) => value),
    );

    return new Promise<kkiapayResult>((resolve, reject) => {
        let settled = false;
        const closed = () => {
            if (!settled) {
                settled = true;
                reject(
                    new StakPassError(SDK_ERROR.PAYMENT_CLOSED, 0, 'The payment was not completed'),
                );
            }
        };
        handlers = {
            success: (response) => {
                if (!settled) {
                    settled = true;
                    resolve({ transactionId: response?.transactionId });
                }
            },
            failed: closed,
            close: closed,
        };
        widget.openkkiapayWidget({
            amount: metadata.amount,
            key: metadata.publicKey,
            sandbox: metadata.sandbox,
            reason: metadata.reason,
            data: metadata.stateData,
            ...widgetOptions,
        });
    });
}

/** Sends the buyer to the Stripe Checkout page. The page unloads; the buyer comes back to `returnUrl`. */
export function redirectToStripe(metadata: StripeMetadata) {
    if (!isBrowser()) {
        throw new StakPassError(SDK_ERROR.BROWSER_ONLY, 0, 'A redirect needs a page');
    }
    globalThis.location.assign(metadata.url);
}

export interface CheckoutOptions extends PollOptions {
    provider: 'KKIAPAY' | 'STRIPE';
    /** Required for STRIPE: an HTTPS page of one of the key's sites. */
    returnUrl?: string;
    buyer?: Buyer;
    /** kkiapay only: the widget's accent color, a hex string such as `#7C3AED`. */
    theme?: string;
}

/**
 * Pays an order end to end. KKIAPAY: starts the payment, opens the widget, then waits until the
 * backend sees the order paid and resolves with it. STRIPE: starts the payment and redirects; the
 * promise never settles, read the result with `parsePaymentReturn` on the return page.
 */
export async function checkout(
    sp: StakPass,
    orderId: string,
    options: CheckoutOptions,
): Promise<PartnerOrder> {
    const initiation: PaymentInitiation = await sp.orders.pay(orderId, options, options);
    if (initiation.provider === 'STRIPE') {
        redirectToStripe(initiation.metadata);

        return new Promise<PartnerOrder>(() => undefined);
    }
    await payWithkkiapay(initiation.metadata, { buyer: options.buyer, theme: options.theme });

    return sp.orders.waitForPayment(orderId, options);
}
