// Runs the built package on the Node version that executes it: no test runner, no pnpm.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { StakPass, StakPassError } from '../dist/index.mjs';

const calls = [];
const fakeFetch = async (url, init) => {
    calls.push({ url, init });

    return new Response(JSON.stringify({ id: 'event_1' }), { status: 200 });
};

const sp = StakPass.init({ secretKey: 'spk_live_smoke', fetch: fakeFetch });
assert.deepEqual(await sp.event.get(), { id: 'event_1' });
assert.equal(calls[0].url, 'https://api.stakpass.com/core/partner/v1/event');
assert.equal(calls[0].init.headers['X-Api-Key'], 'spk_live_smoke');

await sp.orders.create({ buyer: { email: 'a@b.co' } });
assert.match(calls[1].init.headers['Idempotency-Key'], /^sp_[0-9a-f]{32}$/);

assert.throws(() => StakPass.init({}), StakPassError);

const require = createRequire(import.meta.url);
assert.equal(typeof require('../dist/index.cjs').StakPass.init, 'function');
console.log(`smoke ok on Node ${process.version}`);
