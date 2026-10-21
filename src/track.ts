import { isBrowser, randomId, safeStorage } from './env';
import type { HttpClient } from './http';
import type { CallOptions, SharePlatform, TrackViewInput } from './types';

const VISITOR_KEY = 'stakpass:visitor';
const VISITOR_ID_MAX_LENGTH = 64;
const UTM_MAX_LENGTH = 200;
const REFERRER_MAX_LENGTH = 2048;

/** A random id kept in localStorage so a visit counts once per visitor; memory-only when blocked. */
function loadVisitorId() {
    const storage = safeStorage('localStorage');
    try {
        const stored = storage?.getItem(VISITOR_KEY);
        if (stored) {
            return stored;
        }
        const created = randomId();
        storage?.setItem(VISITOR_KEY, created);

        return created;
    } catch {
        return randomId();
    }
}

function utmFromLocation() {
    if (!isBrowser()) {
        return {};
    }
    const params = new URLSearchParams(globalThis.location?.search ?? '');

    return {
        utmSource: params.get('utm_source') ?? undefined,
        utmMedium: params.get('utm_medium') ?? undefined,
        utmCampaign: params.get('utm_campaign') ?? undefined,
    };
}

export class TrackResource {
    private visitorId: string | undefined;

    constructor(private readonly http: HttpClient) {}

    private visitor() {
        this.visitorId ??= loadVisitorId();

        return this.visitorId.slice(0, VISITOR_ID_MAX_LENGTH);
    }

    /**
     * Counts a visit of the event page. The backend counts one visit per visitor every 30 minutes,
     * so calling it on every page load is fine. In a page, `referrer` and the `utm_*` parameters
     * default to the current document.
     */
    view(input: TrackViewInput = {}, options: CallOptions = {}) {
        const utm = utmFromLocation();
        const referrer =
            input.referrer ?? (isBrowser() ? globalThis.document?.referrer : undefined);

        return this.http.request<{ deduplicated: boolean }>({
            method: 'POST',
            path: 'view',
            body: {
                visitorId: this.visitor(),
                referrer: referrer ? referrer.slice(0, REFERRER_MAX_LENGTH) : undefined,
                utmSource: (input.utmSource ?? utm.utmSource)?.slice(0, UTM_MAX_LENGTH),
                utmMedium: (input.utmMedium ?? utm.utmMedium)?.slice(0, UTM_MAX_LENGTH),
                utmCampaign: (input.utmCampaign ?? utm.utmCampaign)?.slice(0, UTM_MAX_LENGTH),
            },
            signal: options.signal,
        });
    }

    /** Counts a share of the event, per platform. */
    share(platform: SharePlatform, options: CallOptions = {}) {
        return this.http.request<{ recorded: boolean }>({
            method: 'POST',
            path: 'share',
            body: { platform, visitorId: this.visitor() },
            signal: options.signal,
        });
    }
}
