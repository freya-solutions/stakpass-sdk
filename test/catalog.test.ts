import { describe, expect, it } from 'vitest';
import { StakPass, StakPassError } from '../src';
import { fakeFetch, PUBLISHABLE } from './helpers';

const quiet = { autoTrackView: false, maxRetries: 0 };
const FIELDS = [
    {
        id: 'f1',
        scope: 'ORDER',
        type: 'TEXT',
        label: 'Entreprise',
        helpText: null,
        required: true,
        options: null,
        position: 0,
        ticketIds: [],
    },
];

describe('attendeeFormFields', () => {
    it('lists the questions', async () => {
        const { fetch, calls } = fakeFetch({ body: FIELDS });
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...quiet });
        await expect(sp.attendeeFormFields.list()).resolves.toEqual(FIELDS);
        expect(calls[0]?.url).toBe('https://api.stakpass.com/core/partner/v1/attendee-form-fields');
        expect(calls[0]?.init.method ?? 'GET').toBe('GET');
    });

    it('surfaces PLAN_FEATURE_UNAVAILABLE', async () => {
        const { fetch } = fakeFetch({
            status: 403,
            body: {
                statusCode: 403,
                message: 'PLAN_FEATURE_UNAVAILABLE',
                error: 'Forbidden',
                upgradeUrl: 'https://x',
            },
        });
        const sp = StakPass.init({ publishableKey: PUBLISHABLE, fetch, ...quiet });
        const error = await sp.attendeeFormFields.list().catch((e) => e);
        expect(error).toBeInstanceOf(StakPassError);
        expect(error.code).toBe('PLAN_FEATURE_UNAVAILABLE');
        expect(error.status).toBe(403);
        expect(error.data).toMatchObject({ upgradeUrl: 'https://x' });
    });
});
