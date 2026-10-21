import { safeStorage } from './env';

const TOKEN_PREFIX = 'stakpass:order-token:';

/**
 * Order access tokens of a browser key. They live in sessionStorage so a Stripe redirect that comes
 * back to the same tab can still read the order; they never go in localStorage, so a closed tab
 * forgets them. Without storage they stay in memory.
 */
export class OrderTokenStore {
    private readonly memory = new Map<string, string>();
    private readonly storage = safeStorage('sessionStorage');

    get(orderId: string) {
        return (
            this.memory.get(orderId) ?? this.storage?.getItem(TOKEN_PREFIX + orderId) ?? undefined
        );
    }

    set(orderId: string, token: string) {
        this.memory.set(orderId, token);
        try {
            this.storage?.setItem(TOKEN_PREFIX + orderId, token);
        } catch {
            // Storage full or blocked: the in-memory copy still serves this page.
        }
    }

    forget(orderId: string) {
        this.memory.delete(orderId);
        try {
            this.storage?.removeItem(TOKEN_PREFIX + orderId);
        } catch {
            // Nothing to clean up.
        }
    }
}
