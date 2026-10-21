import { afterEach, describe, expect, it } from 'vitest';
import { StakPass, StakPassError } from '../src';
import { fakeFetch, PUBLISHABLE, pretendBrowser, SECRET } from './helpers';

describe('StakPass.init', () => {
    let restore: (() => void) | undefined;
    afterEach(() => restore?.());

    it('picks the mode from the key', () => {
        const { fetch } = fakeFetch({});
        expect(StakPass.init({ secretKey: SECRET, fetch }).mode).toBe('server');
        expect(
            StakPass.init({ publishableKey: PUBLISHABLE, fetch, autoTrackView: false }).mode,
        ).toBe('browser');
    });

    it('rejects a missing key, both keys and a key of the wrong kind', () => {
        const { fetch } = fakeFetch({});
        expect(() => StakPass.init({ fetch })).toThrow(StakPassError);
        expect(() =>
            StakPass.init({ fetch, secretKey: SECRET, publishableKey: PUBLISHABLE }),
        ).toThrow(/not both/);
        expect(() => StakPass.init({ fetch, secretKey: PUBLISHABLE })).toThrow(/spk_live_/);
        expect(() => StakPass.init({ fetch, publishableKey: SECRET })).toThrow(/spk_pub_/);
    });

    it('refuses a secret key in a page', () => {
        restore = pretendBrowser();
        const { fetch, calls } = fakeFetch({});
        expect(() => StakPass.init({ secretKey: SECRET, fetch })).toThrowError(
            expect.objectContaining({ code: 'SECRET_KEY_IN_BROWSER' }),
        );
        expect(calls).toHaveLength(0);
    });

    it('counts a visit on init with a publishable key, unless told not to', async () => {
        restore = pretendBrowser({ referrer: 'https://news.example/' });
        const { fetch, calls } = fakeFetch({ body: { deduplicated: false } });
        StakPass.init({ publishableKey: PUBLISHABLE, fetch });
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://api.stakpass.com/core/partner/v1/view');
        const body = JSON.parse(String(calls[0]?.init.body));
        expect(body.visitorId).toMatch(/^[0-9a-f]{32}$/);
        expect(body.referrer).toBe('https://news.example/');

        const quiet = fakeFetch({});
        StakPass.init({ publishableKey: PUBLISHABLE, fetch: quiet.fetch, autoTrackView: false });
        expect(quiet.calls).toHaveLength(0);
    });

    it('never counts a visit with a secret key', () => {
        const { fetch, calls } = fakeFetch({});
        StakPass.init({ secretKey: SECRET, fetch });
        expect(calls).toHaveLength(0);
    });
});
