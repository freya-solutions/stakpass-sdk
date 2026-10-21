import type { HttpClient } from './http';
import type { CallOptions, PartnerEvent, PartnerPack, PartnerTicket, PromoCode } from './types';

export class EventResource {
    constructor(private readonly http: HttpClient) {}

    /** The event the key belongs to. */
    get(options: CallOptions = {}) {
        return this.http.request<PartnerEvent>({ path: 'event', signal: options.signal });
    }
}

export class TicketsResource {
    constructor(private readonly http: HttpClient) {}

    list(options: CallOptions = {}) {
        return this.http.request<Array<PartnerTicket>>({ path: 'tickets', signal: options.signal });
    }
}

export class PacksResource {
    constructor(private readonly http: HttpClient) {}

    list(options: CallOptions = {}) {
        return this.http.request<Array<PartnerPack>>({
            path: 'ticket-packs',
            signal: options.signal,
        });
    }
}

export class PromoResource {
    constructor(private readonly http: HttpClient) {}

    /**
     * Checks a code for this event. Rejects with `PROMO_CODE_NOT_FOUND`, `_INACTIVE`, `_NOT_STARTED`,
     * `_EXPIRED` or `_USAGE_LIMIT_REACHED`. The order applies the discount; here it is only shown.
     */
    validate(code: string, options: CallOptions = {}) {
        return this.http.request<PromoCode>({
            path: 'promo-codes/validate',
            query: { code },
            signal: options.signal,
        });
    }
}
