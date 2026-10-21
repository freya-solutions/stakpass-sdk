export type EventStatus = 'DRAFTED' | 'PUBLISHED' | 'ENDED' | 'ARCHIVED';
export type EventType = 'LIVE' | 'ONLINE';
export type TicketType = 'NORMAL' | 'GUEST';
export type DiscountType = 'FIXED' | 'PERCENTAGE';
export type PaymentProvider = 'CASH' | 'STRIPE' | 'KKIAPAY' | 'FEDAPAY' | 'PAYDUNYA';
/** Providers a partner site can start a payment with. */
export type OnlinePaymentProvider = Extract<PaymentProvider, 'KKIAPAY' | 'STRIPE'>;
export type OrderStatus = 'INIT' | 'PENDING' | 'PAID' | 'REFUND' | 'CANCELLED';
export type UserTicketStatus = 'UNVERIFIED' | 'VERIFIED' | 'REVOKED' | 'USED';

export const SHARE_PLATFORMS = ['LINK', 'WHATSAPP', 'TWITTER', 'FACEBOOK'] as const;
export type SharePlatform = (typeof SHARE_PLATFORMS)[number];

/** Statuses an order never leaves: stop polling once it reaches one. */
export const FINAL_ORDER_STATUSES: ReadonlyArray<OrderStatus> = ['PAID', 'REFUND', 'CANCELLED'];

/** Backend limits, used to validate a cart before it is sent. */
export const MAX_ORDER_LINE_QUANTITY = 100;
export const MAX_ORDER_TICKETS = 200;

export interface PartnerEvent {
    id: string;
    slug: string;
    title: string;
    description: string;
    coverKey: string | null;
    logoKey: string | null;
    startingDate: string;
    endingDate: string;
    timeZone: string;
    type: EventType;
    status: EventStatus;
    categories: Array<string>;
    location: Record<string, unknown> | null;
    host: { id: string; name: string; avatarKey: string | null; avatarUrl: string | null };
    tags: Array<Record<string, unknown>>;
    enabledPaymentProviders: Array<PaymentProvider>;
    organizerBearsFees: boolean;
}

export interface PartnerTicket {
    id: string;
    title: string;
    description: string | null;
    price: number;
    capacity: number | null;
    soldCount: number;
    type: TicketType;
    /** False when the ticket is listed but cannot be bought now. */
    salesOpen: boolean;
}

export interface PartnerPack {
    id: string;
    title: string;
    description: string | null;
    price: number;
    capacity: number | null;
    soldCount: number;
    items: Array<{ id: string; quantity: number; ticketId: string }>;
}

export interface PromoCode {
    code: string;
    discountType: DiscountType;
    discountValue: number;
}

export interface OrderItem {
    ticketId: string;
    /** Set when the line comes from a pack. */
    ticketPackId: string | null;
    packQuantity: number | null;
    quantity: number;
    unitPrice: number;
}

export interface PartnerOrder {
    id: string;
    status: OrderStatus;
    /** Final amount the buyer pays, fees included and discount deducted. */
    amount: number;
    currency: string;
    paymentProvider: PaymentProvider | null;
    buyerEmail: string | null;
    paidAt: string | null;
    createdAt: string;
    items: Array<OrderItem>;
    /** Only in the answer to `orders.create` with a publishable key, and only once. */
    accessToken?: string;
}

export interface PartnerUserTicket {
    id: string;
    /** What the entrance scan reads. */
    code: string;
    status: UserTicketStatus;
    ticketId: string;
    orderId: string;
}

export interface kkiapayMetadata {
    amount: number;
    publicKey: string;
    sandbox: boolean;
    reason: string;
    stateData: Record<string, string>;
}

export interface StripeMetadata {
    /** Stripe Checkout URL to send the buyer to. */
    url: string;
    sessionId: string;
}

export type PaymentInitiation =
    | { provider: 'KKIAPAY'; metadata: kkiapayMetadata }
    | { provider: 'STRIPE'; metadata: StripeMetadata };

export interface Buyer {
    /** Where the tickets are sent. */
    email: string;
    /** Used only when the account is created by this order. */
    name?: string;
    phone?: string;
}

export interface TicketLine {
    ticketId: string;
    quantity: number;
}

export interface PackLine {
    ticketPackId: string;
    quantity: number;
}

export interface CreateOrderInput {
    buyer: Buyer;
    tickets?: Array<TicketLine>;
    packs?: Array<PackLine>;
    promoCode?: string;
    /** Vendor tracking code of a sales link. Ignored by the backend when unknown. */
    vendorCode?: string;
}

export interface PayInput {
    provider: OnlinePaymentProvider;
    /** HTTPS page the buyer returns to. Required for STRIPE, and its origin must be a site of the key. */
    returnUrl?: string;
}

export interface ListOrdersParams {
    status?: OrderStatus;
    page?: number;
    take?: number;
}

export interface ListOrdersResult {
    data: Array<PartnerOrder>;
    total: number;
}

export interface TrackViewInput {
    /** Defaults to the page's referrer. */
    referrer?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
}

export interface CallOptions {
    signal?: AbortSignal;
}

/** Options of a call that reads an order. */
export interface OrderCallOptions extends CallOptions {
    /** Browser keys only: use this token instead of the one stored when the order was created. */
    orderToken?: string;
}

export interface CreateOrderOptions extends CallOptions {
    /** Secret keys only: defaults to a generated key, which makes retries safe. */
    idempotencyKey?: string;
}

export interface PollOptions extends OrderCallOptions {
    intervalMs?: number;
    maxIntervalMs?: number;
    timeoutMs?: number;
}
