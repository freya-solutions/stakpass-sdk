import { EventResource, PacksResource, PromoResource, TicketsResource } from './catalog';
import { isBrowser, PUBLISHABLE_KEY_PREFIX, SECRET_KEY_PREFIX } from './env';
import { SDK_ERROR, StakPassError } from './errors';
import { HttpClient } from './http';
import { type KeyMode, OrdersResource } from './orders';
import { OrderTokenStore } from './token-store';
import { TrackResource } from './track';

export const DEFAULT_BASE_URL = 'https://api.stakpass.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const TRAILING_SLASHES = /\/+$/;

export interface StakPassConfig {
    /** Key of a web page (`spk_pub_…`). Safe to publish; works only from the sites it lists. */
    publishableKey?: string;
    /** Key of a server (`spk_live_…`). Never put it in a page: `init` refuses it there. */
    secretKey?: string;
    /** Defaults to `https://api.stakpass.com`. */
    baseUrl?: string;
    timeoutMs?: number;
    /** Retries after a network error, a 502/503/504 or a 429. Defaults to 2. */
    maxRetries?: number;
    /** Browser keys: count a visit on `init`. Defaults to true. */
    autoTrackView?: boolean;
    /** A `fetch` to use instead of the global one. */
    fetch?: typeof fetch;
}

function configError(message: string) {
    return new StakPassError(SDK_ERROR.INVALID_CONFIG, 0, message);
}

function resolveKey(config: StakPassConfig): { key: string; mode: KeyMode } {
    const { publishableKey, secretKey } = config;
    if (publishableKey && secretKey) {
        throw configError('Pass either publishableKey or secretKey, not both');
    }
    if (secretKey) {
        if (!secretKey.startsWith(SECRET_KEY_PREFIX)) {
            throw configError(`secretKey must start with ${SECRET_KEY_PREFIX}`);
        }
        if (isBrowser()) {
            throw new StakPassError(
                SDK_ERROR.SECRET_KEY_IN_BROWSER,
                0,
                'A secret key must never run in a browser: anyone could read it. Use a publishable key (spk_pub_) in pages, and the secret key on your server only.',
            );
        }

        return { key: secretKey, mode: 'server' };
    }
    if (publishableKey) {
        if (!publishableKey.startsWith(PUBLISHABLE_KEY_PREFIX)) {
            throw configError(`publishableKey must start with ${PUBLISHABLE_KEY_PREFIX}`);
        }

        return { key: publishableKey, mode: 'browser' };
    }
    throw configError('Pass publishableKey (web page) or secretKey (server)');
}

/**
 * Entry point. `StakPass.init({ publishableKey })` in a page, `StakPass.init({ secretKey })` on a
 * server. Every resource reads the one event the key belongs to.
 */
export class StakPass {
    readonly event: EventResource;
    readonly tickets: TicketsResource;
    readonly packs: PacksResource;
    readonly promo: PromoResource;
    readonly track: TrackResource;
    readonly orders: OrdersResource;
    /** `browser` for a publishable key, `server` for a secret key. */
    readonly mode: KeyMode;

    private constructor(config: StakPassConfig) {
        const { key, mode } = resolveKey(config);
        const fetchImpl = config.fetch ?? globalThis.fetch?.bind(globalThis);
        if (!fetchImpl) {
            throw configError('No fetch available: use Node 18+ or pass config.fetch');
        }
        const http = new HttpClient({
            baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(TRAILING_SLASHES, ''),
            apiKey: key,
            timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
            fetch: fetchImpl,
        });
        this.mode = mode;
        this.event = new EventResource(http);
        this.tickets = new TicketsResource(http);
        this.packs = new PacksResource(http);
        this.promo = new PromoResource(http);
        this.track = new TrackResource(http);
        this.orders = new OrdersResource(http, mode, new OrderTokenStore());

        if (mode === 'browser' && config.autoTrackView !== false) {
            // Statistics must never break the page.
            this.track.view().catch(() => undefined);
        }
    }

    static init(config: StakPassConfig) {
        return new StakPass(config);
    }
}
