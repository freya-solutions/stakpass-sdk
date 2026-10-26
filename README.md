# @stakpass/sdk

Sell your [StakPass](https://stakpass.com) event tickets from your own website or server.

- TypeScript, no runtime dependency, works in browsers, Node 18+ and edge runtimes.
- One package, two modes. The key decides the mode:
  - **Web page** — publishable key `spk_pub_…`. Safe to publish; works only from the sites you list when you create it.
  - **Server** — secret key `spk_live_…`. Never ship it in a page: `StakPass.init` throws if it finds one in a browser.
- API keys belong to **one event** and need the StakPass **PRO** plan. Create them in the dashboard, under the event's *Integration* tab.

```sh
pnpm add @stakpass/sdk      # or npm i / yarn add
```

Without a bundler:

```html
<script src="https://cdn.jsdelivr.net/npm/@stakpass/sdk"></script>
<script>
    const sp = StakPass.init({ publishableKey: 'spk_pub_…' });
</script>
```

## In a web page

```ts
import { StakPass, createCart, parsePaymentReturn } from '@stakpass/sdk';
import { checkout } from '@stakpass/sdk/browser';

const sp = StakPass.init({ publishableKey: 'spk_pub_…' }); // also counts a visit

const event = await sp.event.get();
const tickets = await sp.tickets.list();

const cart = createCart().addTicket(tickets[0].id, 2);
console.log(cart.validate({ tickets }), cart.totals({ tickets }));

// 1. Create the order. The SDK keeps its access token for this tab.
const order = await sp.orders.create({
    buyer: { email: 'ada@example.com', name: 'Ada' },
    ...cart.toOrderItems(),
});

// 2. Pay. kkiapay opens its widget; the promise resolves once the backend sees the order paid.
const paid = await checkout(sp, order.id, { provider: 'KKIAPAY', buyer: { email: 'ada@example.com' } });

// 3. The tickets are issued a moment after payment.
const issued = await sp.orders.waitForTickets(paid.id);
```

Stripe redirects the buyer, so the page unloads. Give it a `returnUrl` on one of your sites and read the result on that page:

```ts
await checkout(sp, order.id, { provider: 'STRIPE', returnUrl: 'https://shop.example/thanks' });

// On https://shop.example/thanks?orderId=…&payment=success
const back = parsePaymentReturn(location.search);
if (back?.payment === 'success') {
    const order = await sp.orders.waitForPayment(back.orderId);
}
```

Your page's Content-Security-Policy must allow `https://api.stakpass.com`, and for kkiapay `https://cdn.kkiapay.me` and its frames.

## Verify the buyer's email

```ts
const sp = StakPass.init({ publishableKey: 'spk_pub_…' });

await sp.buyerVerification.start('ada@example.com');
await sp.buyerVerification.confirm('ada@example.com', codeTypedByTheBuyer); // 400 OTP_INVALID: ask again
await sp.orders.create({ buyer: { email: 'ada@example.com' }, ...cart.toOrderItems() });
```

`orders.create` sends the token held for the buyer's address. On 403 `BUYER_VERIFICATION_INVALID` the token is dropped: verify again. The backend does not require the token: check `sp.buyerVerification.isVerified(email)` before ordering if your page needs it.

## On a server

```ts
import { StakPass } from '@stakpass/sdk';

const sp = StakPass.init({ secretKey: process.env.STAKPASS_SECRET_KEY });

const order = await sp.orders.create({
    buyer: { email: 'ada@example.com' },
    tickets: [{ ticketId: 'ticket_id', quantity: 1 }],
});
// A retry returns the same order: the SDK sends an Idempotency-Key. Pass your own with { idempotencyKey }.

const { data, total } = await sp.orders.list({ status: 'PAID' }); // secret keys only
```

## API

| Call | What it does |
|---|---|
| `StakPass.init({ publishableKey \| secretKey, baseUrl?, timeoutMs?, maxRetries?, autoTrackView?, fetch? })` | Creates the client. `baseUrl` defaults to `https://api.stakpass.com`. |
| `sp.event.get()` | The event the key belongs to. |
| `sp.tickets.list()` / `sp.packs.list()` | What is on sale. `salesOpen: false` means listed but not buyable now. |
| `sp.promo.validate(code)` | Checks a promo code. The order applies the discount. |
| `sp.track.view(input?)` / `sp.track.share(platform)` | Statistics. `platform` is `LINK`, `WHATSAPP`, `TWITTER` or `FACEBOOK`. |
| `sp.buyerVerification.start(email)` / `confirm(email, otp)` | Mails a 6-digit code (10 min), then exchanges it for a single-use token (30 min). The SDK keeps the token in memory and `orders.create` sends it. Wait 60 s before resending; 5 wrong codes burn it. |
| `sp.orders.create({ buyer, tickets?, packs?, promoCode?, vendorCode? })` | Creates an order in `INIT` status. Nothing is reserved until it is paid. |
| `sp.orders.get(id)` / `sp.orders.tickets(id)` | Reads an order and its issued tickets. |
| `sp.orders.receipt(id)` | PDF receipt of a paid order, as a `Blob`. Needs the PRO or CUSTOM plan. A 404 also means "not paid yet": check `get` first. |
| `sp.orders.pay(id, { provider, returnUrl? })` | Starts a payment (`KKIAPAY` or `STRIPE`). A new call makes the previous attempt unpayable. |
| `sp.orders.confirmFree(id)` | Confirms an order that costs nothing (`POST /orders/:id/pos-pay`). Fulfillment starts right away. |
| `sp.orders.confirm(id, { provider?, returnUrl? })` | Confirms an order whatever its price: `confirmFree` when `amount` is 0, `pay` otherwise (then `provider` is required). Returns `{ kind: 'FREE' \| 'PAYMENT', … }`. |
| `sp.orders.watch(id, onChange?)` / `waitForPayment(id)` / `waitForTickets(id)` | Polling with backoff. `watch` returns `{ stop, done }`. |
| `sp.orders.list(params?)` | Orders of the key. Secret keys only. |
| `createCart()` | In-memory basket: `addTicket`, `addPack`, `setTicket`, `remove…`, `totals`, `validate`, `toOrderItems`. Totals are indicative; the backend is the authority and adds the fees. |
| `checkout(sp, orderId, options)` · `payWithkkiapay` · `redirectToStripe` (`@stakpass/sdk/browser`) | Payment helpers for a page. |
| `parsePaymentReturn(search)` | Reads `?orderId=…&payment=success\|cancelled`. |

Order statuses: `INIT`, `PENDING`, `PAID`, `REFUND`, `CANCELLED`. The last three are final.

### Errors

Every failure is a `StakPassError { code, status, message, details?, retryAfter?, requestId? }`. `code` is the backend's (`ORDER_NOT_FOUND`, `INVALID_API_KEY`, `RATE_LIMIT_EXCEEDED`, `INSUFFICIENT_STOCK`, `PLAN_FEATURE_UNAVAILABLE`, …) or one of `SDK_ERROR` (`NETWORK_ERROR`, `TIMEOUT`, `ABORTED`, `SECRET_KEY_IN_BROWSER`, `SERVER_ONLY`, …). A validation failure has code `VALIDATION_ERROR` and the messages in `details`. Quote `requestId` when you contact support.

### Retries and timeouts

Network errors, 502/503/504 and 429 (when `Retry-After` is 10 s or less) are retried up to `maxRetries` times (default 2), with backoff. A 429 is retried on any call, since nothing ran. Other failures are retried only on reads, and on `orders.create` with a secret key, where the idempotency key makes it safe. With a publishable key, `orders.create` is never resent: check whether an order exists before trying again. Every call accepts `{ signal }` to abort it.

## Security notes

- A publishable key is public by design. The backend accepts it only from the sites listed on the key, and never sends or accepts cookies on this API.
- An order created from a page can only be read, paid and listed with the access token returned once at creation. The SDK keeps it in `sessionStorage`; losing it makes the order unreadable (404).
- A page can create guest orders for any email address; each order and payment attempt is rate-limited per visitor and per email.
- Revoking a key in the dashboard stops it working within about a minute.

## Development

```sh
pnpm install
pnpm check && pnpm typecheck && pnpm test && pnpm build
pnpm release        # bumpp: pick the version, run the checks, commit, tag and push
```

## License

MIT
