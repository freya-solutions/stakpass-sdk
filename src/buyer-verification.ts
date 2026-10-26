import type { HttpClient } from './http';
import type { BuyerVerification, CallOptions, OkFlag } from './types';

export function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

/**
 * Verification tokens, in memory only: a token is single-use and valid 30 minutes, so a reload
 * is better off asking for a new code than finding an old token in storage.
 */
export class VerificationTokenStore {
    private readonly tokens = new Map<string, BuyerVerification>();

    get(email: string) {
        const key = normalizeEmail(email);
        const entry = this.tokens.get(key);
        if (entry && Date.parse(entry.expiresAt) <= Date.now()) {
            this.tokens.delete(key);

            return undefined;
        }

        return entry?.verificationToken;
    }

    set(email: string, verification: BuyerVerification) {
        this.tokens.set(normalizeEmail(email), verification);
    }

    forget(email: string) {
        this.tokens.delete(normalizeEmail(email));
    }
}

/** Proves a buyer owns an email address before an order: a code is mailed, then exchanged for a token. */
export class BuyerVerificationResource {
    constructor(
        private readonly http: HttpClient,
        private readonly tokens: VerificationTokenStore,
    ) {}

    /**
     * Mails a 6-digit code, valid 10 minutes. A new code replaces the previous one. The answer is the
     * same whether or not the address has an account. Allow one call per minute and five per hour per
     * address: block "resend" for 60 s after a success.
     */
    start(email: string, options: CallOptions = {}) {
        return this.http.request<OkFlag>({
            method: 'POST',
            path: 'buyer-verification/start',
            body: { email: normalizeEmail(email) },
            signal: options.signal,
        });
    }

    /**
     * Exchanges the code for a verification token. The SDK keeps it in memory and `orders.create`
     * sends it for this address. Fails with 400 `OTP_INVALID` on a wrong or expired code; after five
     * wrong tries the code is burnt and `start` must be called again. Never loop on this call.
     */
    async confirm(email: string, otp: string, options: CallOptions = {}) {
        const verification = await this.http.request<BuyerVerification>({
            method: 'POST',
            path: 'buyer-verification/confirm',
            body: { email: normalizeEmail(email), otp },
            signal: options.signal,
        });
        this.tokens.set(email, verification);

        return verification;
    }

    /** True while a token is held for this address, so `orders.create` can go ahead. */
    isVerified(email: string) {
        return this.tokens.get(email) !== undefined;
    }
}
