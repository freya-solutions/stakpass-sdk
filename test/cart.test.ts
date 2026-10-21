import { describe, expect, it } from 'vitest';
import { createCart, type PartnerPack, type PartnerTicket } from '../src';

const ticket = (overrides: Partial<PartnerTicket> = {}): PartnerTicket => ({
    id: 't1',
    title: 'Standard',
    description: null,
    price: 5000,
    capacity: 100,
    soldCount: 10,
    type: 'NORMAL',
    salesOpen: true,
    ...overrides,
});

const pack: PartnerPack = {
    id: 'p1',
    title: 'Duo',
    description: null,
    price: 9000,
    capacity: null,
    soldCount: 0,
    items: [{ id: 'i1', quantity: 2, ticketId: 't1' }],
};

describe('cart', () => {
    it('adds, sets and removes lines', () => {
        const cart = createCart().addTicket('t1').addTicket('t1', 2).addPack('p1');
        expect(cart.toOrderItems()).toEqual({
            tickets: [{ ticketId: 't1', quantity: 3 }],
            packs: [{ ticketPackId: 'p1', quantity: 1 }],
        });
        cart.setTicket('t1', 0).removePack('p1');
        expect(cart.isEmpty()).toBe(true);
    });

    it('rejects a quantity that is not a whole number', () => {
        expect(() => createCart().addTicket('t1', 1.5)).toThrow(RangeError);
    });

    it('computes totals and discounts', () => {
        const catalog = { tickets: [ticket()], packs: [pack] };
        const cart = createCart({
            tickets: [{ ticketId: 't1', quantity: 2 }],
            packs: [{ ticketPackId: 'p1', quantity: 1 }],
        });
        expect(cart.totals(catalog)).toEqual({ subtotal: 19_000, discount: 0, total: 19_000 });
        expect(cart.totals(catalog, { discountType: 'PERCENTAGE', discountValue: 10 })).toEqual({
            subtotal: 19_000,
            discount: 1900,
            total: 17_100,
        });
        expect(cart.totals(catalog, { discountType: 'FIXED', discountValue: 50_000 }).total).toBe(
            0,
        );
    });

    it('counts the tickets a pack holds', () => {
        const cart = createCart({
            tickets: [{ ticketId: 't1', quantity: 1 }],
            packs: [{ ticketPackId: 'p1', quantity: 3 }],
        });
        expect(cart.ticketCount({ tickets: [ticket()], packs: [pack] })).toBe(7);
    });

    it('reports what the backend would reject', () => {
        const catalog = {
            tickets: [ticket({ id: 't1', capacity: 12 }), ticket({ id: 't2', salesOpen: false })],
            packs: [pack],
        };
        expect(createCart().validate(catalog)).toEqual([{ code: 'EMPTY' }]);

        const cart = createCart({
            tickets: [
                { ticketId: 't1', quantity: 5 },
                { ticketId: 't2', quantity: 1 },
                { ticketId: 'gone', quantity: 1 },
            ],
            packs: [{ ticketPackId: 'nope', quantity: 1 }],
        });
        expect(cart.validate(catalog)).toEqual([
            { code: 'INSUFFICIENT_STOCK', id: 't1' },
            { code: 'SALES_CLOSED', id: 't2' },
            { code: 'TICKET_NOT_FOUND', id: 'gone' },
            { code: 'PACK_NOT_FOUND', id: 'nope' },
        ]);
    });

    it('flags a line or an order that is too big', () => {
        const catalog = { tickets: [ticket({ capacity: null })], packs: [] };
        expect(createCart().addTicket('t1', 101).validate(catalog)).toContainEqual({
            code: 'QUANTITY_TOO_HIGH',
            id: 't1',
        });
        const many = createCart().addTicket('t1', 100);
        const second = {
            tickets: [ticket({ id: 't1', capacity: null }), ticket({ id: 't2', capacity: null })],
            packs: [],
        };
        many.addTicket('t2', 100).addTicket('t3', 1);
        expect(many.validate(second)).toContainEqual({ code: 'TOO_MANY_TICKETS' });
    });
});
