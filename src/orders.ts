import { randomId } from './env';
import { SDK_ERROR, StakPassError } from './errors';
import type { HttpClient } from './http';
import { startPolling, type Watch } from './poll';
import type { OrderTokenStore } from './token-store';
import {
    type CallOptions,
    type CreateOrderInput,
    type CreateOrderOptions,
    FINAL_ORDER_STATUSES,
    type ListOrdersParams,
    type ListOrdersResult,
    type OrderCallOptions,
    type PartnerOrder,
    type PartnerUserTicket,
    type PayInput,
    type PaymentInitiation,
    type PollOptions,
} from './types';

export type KeyMode = 'browser' | 'server';

const ORDER_TOKEN_HEADER = 'X-Order-Token';
const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export class OrdersResource {
    constructor(
        private readonly http: HttpClient,
        private readonly mode: KeyMode,
        private readonly tokens: OrderTokenStore,
    ) {}

    /** Browser keys prove access to an order with the token returned when it was created. */
    private orderHeaders(orderId: string, options: OrderCallOptions) {
        if (this.mode !== 'browser') {
            return {};
        }

        return { [ORDER_TOKEN_HEADER]: options.orderToken ?? this.tokens.get(orderId) };
    }

    /**
     * Creates an order in `INIT` status. Nothing is reserved until it is paid. With a browser key the
     * answer carries `accessToken` once; the SDK keeps it for this tab. With a secret key the call is
     * safe to retry: the same idempotency key returns the same order for 24 hours.
     */
    async create(input: CreateOrderInput, options: CreateOrderOptions = {}) {
        const server = this.mode === 'server';
        const order = await this.http.request<PartnerOrder>({
            method: 'POST',
            path: 'orders',
            body: {
                buyer: input.buyer,
                tickets: input.tickets ?? [],
                packs: input.packs ?? [],
                promoCode: input.promoCode,
                vendorCode: input.vendorCode,
            },
            headers: server
                ? { [IDEMPOTENCY_HEADER]: options.idempotencyKey ?? `sp_${randomId()}` }
                : undefined,
            retryable: server,
            signal: options.signal,
        });
        if (order.accessToken) {
            this.tokens.set(order.id, order.accessToken);
        }

        return order;
    }

    get(orderId: string, options: OrderCallOptions = {}) {
        return this.http.request<PartnerOrder>({
            path: `orders/${encodeURIComponent(orderId)}`,
            headers: this.orderHeaders(orderId, options),
            signal: options.signal,
        });
    }

    /** Tickets of a paid order. Empty until the order is fulfilled: see `waitForTickets`. */
    tickets(orderId: string, options: OrderCallOptions = {}) {
        return this.http.request<Array<PartnerUserTicket>>({
            path: `orders/${encodeURIComponent(orderId)}/tickets`,
            headers: this.orderHeaders(orderId, options),
            signal: options.signal,
        });
    }

    /**
     * PDF receipt of a paid order, as a `Blob` (`type` is `application/pdf`). The 404 `ORDER_NOT_FOUND`
     * also covers an order that is not `PAID` yet or a wrong token: check `get` first. The event host
     * needs the PRO or CUSTOM plan, otherwise 403 `PLAN_FEATURE_UNAVAILABLE`.
     */
    receipt(orderId: string, options: OrderCallOptions = {}) {
        return this.http.request<Blob>({
            path: `orders/${encodeURIComponent(orderId)}/receipt`,
            headers: this.orderHeaders(orderId, options),
            responseType: 'binary',
            signal: options.signal,
        });
    }

    /** Orders created by this key, newest first. Secret keys only. */
    list(params: ListOrdersParams = {}, options: CallOptions = {}) {
        if (this.mode !== 'server') {
            throw new StakPassError(
                SDK_ERROR.SERVER_ONLY,
                0,
                'orders.list needs a secret key and must run on a server',
            );
        }

        return this.http.request<ListOrdersResult>({
            path: 'orders',
            query: { status: params.status, page: params.page, take: params.take },
            signal: options.signal,
        });
    }

    /**
     * Picks the provider and returns what the buyer needs to pay: the widget parameters for KKIAPAY,
     * a checkout URL for STRIPE. Calling it again makes the previous attempt unpayable.
     * `@stakpass/sdk/browser` has helpers that open the widget or redirect.
     */
    pay(orderId: string, input: PayInput, options: OrderCallOptions = {}) {
        return this.http.request<PaymentInitiation>({
            method: 'POST',
            path: `orders/${encodeURIComponent(orderId)}/initiate-payment`,
            body: { provider: input.provider, returnUrl: input.returnUrl },
            headers: this.orderHeaders(orderId, options),
            signal: options.signal,
        });
    }

    /**
     * Polls the order until it is `PAID`, `REFUND` or `CANCELLED`, calling `onChange` on each status
     * change. Gives up after `timeoutMs` (10 minutes by default) and on a 4xx other than 408/429.
     */
    watch(
        orderId: string,
        onChange?: (order: PartnerOrder) => void,
        options: PollOptions = {},
    ): Watch<PartnerOrder> {
        return startPolling({
            read: (signal) => this.get(orderId, { ...options, signal }),
            isDone: (order) => FINAL_ORDER_STATUSES.includes(order.status),
            onChange,
            changeKey: (order) => order.status,
            intervalMs: options.intervalMs,
            maxIntervalMs: options.maxIntervalMs,
            timeoutMs: options.timeoutMs,
            signal: options.signal,
        });
    }

    /** Resolves with the order once its status is final. */
    waitForPayment(orderId: string, options: PollOptions = {}) {
        return this.watch(orderId, undefined, options).done;
    }

    /** A paid order issues its tickets a moment later: resolves once there is at least one. */
    waitForTickets(orderId: string, options: PollOptions = {}) {
        return startPolling({
            read: (signal) => this.tickets(orderId, { ...options, signal }),
            isDone: (tickets) => tickets.length > 0,
            intervalMs: options.intervalMs,
            maxIntervalMs: options.maxIntervalMs,
            timeoutMs: options.timeoutMs,
            signal: options.signal,
        }).done;
    }
}

export type PaymentReturn = { orderId: string; payment: 'success' | 'cancelled' };

/**
 * Reads the query the buyer comes back with after Stripe (`?orderId=…&payment=success|cancelled`).
 * Accepts a full URL, a `location.search` string or a `URLSearchParams`. Returns undefined when the
 * query is not a StakPass return.
 */
export function parsePaymentReturn(source: string | URLSearchParams): PaymentReturn | undefined {
    let params: URLSearchParams;
    if (typeof source === 'string') {
        const query = source.includes('?') ? source.slice(source.indexOf('?')) : source;
        params = new URLSearchParams(query);
    } else {
        params = source;
    }
    const orderId = params.get('orderId');
    const payment = params.get('payment');
    if (!orderId || (payment !== 'success' && payment !== 'cancelled')) {
        return undefined;
    }

    return { orderId, payment };
}
