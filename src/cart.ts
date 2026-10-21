import {
    MAX_ORDER_LINE_QUANTITY,
    MAX_ORDER_TICKETS,
    type PackLine,
    type PartnerPack,
    type PartnerTicket,
    type PromoCode,
    type TicketLine,
} from './types';

export interface Catalog {
    tickets: ReadonlyArray<PartnerTicket>;
    packs?: ReadonlyArray<PartnerPack>;
}

export type CartIssueCode =
    | 'QUANTITY_TOO_HIGH'
    | 'TICKET_NOT_FOUND'
    | 'PACK_NOT_FOUND'
    | 'SALES_CLOSED'
    | 'INSUFFICIENT_STOCK'
    | 'TOO_MANY_TICKETS'
    | 'EMPTY';

export interface CartIssue {
    code: CartIssueCode;
    /** The ticket or pack concerned, when the issue is about one line. */
    id?: string;
}

export interface CartTotals {
    subtotal: number;
    discount: number;
    total: number;
}

function isWholeNumber(value: number) {
    return Number.isInteger(value) && value > 0;
}

/**
 * A basket kept in memory. It prepares what `orders.create` takes and shows an indicative total. The
 * backend stays the authority: it re-checks stock and prices, and adds the fees to the amount.
 */
export class Cart {
    private readonly tickets = new Map<string, number>();
    private readonly packs = new Map<string, number>();

    constructor(initial: { tickets?: Array<TicketLine>; packs?: Array<PackLine> } = {}) {
        for (const line of initial.tickets ?? []) {
            this.setTicket(line.ticketId, line.quantity);
        }
        for (const line of initial.packs ?? []) {
            this.setPack(line.ticketPackId, line.quantity);
        }
    }

    addTicket(ticketId: string, quantity = 1) {
        return this.setTicket(ticketId, (this.tickets.get(ticketId) ?? 0) + quantity);
    }

    addPack(ticketPackId: string, quantity = 1) {
        return this.setPack(ticketPackId, (this.packs.get(ticketPackId) ?? 0) + quantity);
    }

    /** A quantity of 0 or less removes the line. */
    setTicket(ticketId: string, quantity: number) {
        return this.set(this.tickets, ticketId, quantity);
    }

    setPack(ticketPackId: string, quantity: number) {
        return this.set(this.packs, ticketPackId, quantity);
    }

    removeTicket(ticketId: string) {
        this.tickets.delete(ticketId);

        return this;
    }

    removePack(ticketPackId: string) {
        this.packs.delete(ticketPackId);

        return this;
    }

    clear() {
        this.tickets.clear();
        this.packs.clear();

        return this;
    }

    isEmpty() {
        return this.tickets.size === 0 && this.packs.size === 0;
    }

    /** Lines as they are sent: spread it into `orders.create({ buyer, ...cart.toOrderItems() })`. */
    toOrderItems() {
        return {
            tickets: [...this.tickets].map(([ticketId, quantity]) => ({ ticketId, quantity })),
            packs: [...this.packs].map(([ticketPackId, quantity]) => ({ ticketPackId, quantity })),
        };
    }

    /** Tickets the buyer receives, packs expanded. */
    ticketCount(catalog: Catalog) {
        let count = 0;
        for (const quantity of this.tickets.values()) {
            count += quantity;
        }
        for (const [packId, quantity] of this.packs) {
            const pack = catalog.packs?.find((candidate) => candidate.id === packId);
            for (const item of pack?.items ?? []) {
                count += item.quantity * quantity;
            }
        }

        return count;
    }

    /** Indicative amounts before fees. Unknown ids count for 0: `validate` reports them. */
    totals(
        catalog: Catalog,
        promo?: Pick<PromoCode, 'discountType' | 'discountValue'>,
    ): CartTotals {
        let subtotal = 0;
        for (const [ticketId, quantity] of this.tickets) {
            const ticket = catalog.tickets.find((candidate) => candidate.id === ticketId);
            subtotal += (ticket?.price ?? 0) * quantity;
        }
        for (const [packId, quantity] of this.packs) {
            const pack = catalog.packs?.find((candidate) => candidate.id === packId);
            subtotal += (pack?.price ?? 0) * quantity;
        }
        let discount = 0;
        if (promo?.discountType === 'PERCENTAGE') {
            discount = Math.round((subtotal * promo.discountValue) / 100);
        } else if (promo?.discountType === 'FIXED') {
            discount = promo.discountValue;
        }
        discount = Math.min(Math.max(discount, 0), subtotal);

        return { subtotal, discount, total: subtotal - discount };
    }

    /** Problems the backend would reject, found before the call. Empty means nothing obvious. */
    validate(catalog: Catalog): Array<CartIssue> {
        const issues: Array<CartIssue> = [];
        if (this.isEmpty()) {
            return [{ code: 'EMPTY' }];
        }
        for (const [ticketId, quantity] of this.tickets) {
            const ticket = catalog.tickets.find((candidate) => candidate.id === ticketId);
            issues.push(...this.lineIssues('TICKET_NOT_FOUND', ticketId, quantity, ticket));
        }
        for (const [packId, quantity] of this.packs) {
            const pack = catalog.packs?.find((candidate) => candidate.id === packId);
            issues.push(...this.lineIssues('PACK_NOT_FOUND', packId, quantity, pack));
        }
        if (this.ticketCount(catalog) > MAX_ORDER_TICKETS) {
            issues.push({ code: 'TOO_MANY_TICKETS' });
        }

        return issues;
    }

    private lineIssues(
        missing: 'TICKET_NOT_FOUND' | 'PACK_NOT_FOUND',
        id: string,
        quantity: number,
        entry: { capacity: number | null; soldCount: number; salesOpen?: boolean } | undefined,
    ): Array<CartIssue> {
        if (!entry) {
            return [{ code: missing, id }];
        }
        const issues: Array<CartIssue> = [];
        if (quantity > MAX_ORDER_LINE_QUANTITY) {
            issues.push({ code: 'QUANTITY_TOO_HIGH', id });
        }
        if (entry.salesOpen === false) {
            issues.push({ code: 'SALES_CLOSED', id });
        }
        if (entry.capacity !== null && entry.capacity - entry.soldCount < quantity) {
            issues.push({ code: 'INSUFFICIENT_STOCK', id });
        }

        return issues;
    }

    private set(lines: Map<string, number>, id: string, quantity: number) {
        if (quantity <= 0) {
            lines.delete(id);
        } else if (isWholeNumber(quantity)) {
            lines.set(id, quantity);
        } else {
            throw new RangeError('A quantity must be a whole number');
        }

        return this;
    }
}

export function createCart(initial?: ConstructorParameters<typeof Cart>[0]) {
    return new Cart(initial);
}
