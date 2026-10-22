# SDK StakPass (`@stakpass/sdk`) — fonctionnalités

Ce document liste ce que le SDK doit offrir. Il sert de cahier des charges pour la phase 7 (voir `../tasks/todo.md`).

Le SDK permet à l'organisateur d'un événement de vendre ses billets sur son propre site, avec la clé d'API de cet événement (plan PRO). Il est écrit en TypeScript, sans dépendance, et appelle l'API partenaire du gateway (`/core/partner/v1/*`).

## 1. Modes d'utilisation

Un seul package, deux modes. Le mode est déduit du préfixe de la clé.

| | Navigateur | Serveur |
|---|---|---|
| Clé | publiable `spk_pub_…` | secrète `spk_live_…` |
| `Origin` | envoyé par le navigateur, doit correspondre exactement à un site autorisé de la clé | jamais envoyé |
| `Idempotency-Key` | non | oui, généré automatiquement |
| `orders.list` | refusé (403 `API_KEY_KIND_NOT_ALLOWED`) | oui |
| Accès à une commande | `X-Order-Token` | par la clé |
| Helpers de paiement (widget) | oui | non |

Règles :
- `init` lève une erreur si une clé `spk_live_` est utilisée dans un navigateur (`typeof window !== 'undefined'`).
- `init` lève une erreur si la clé n'a aucun des deux préfixes connus.
- Environnements : navigateurs modernes, Node 18+, runtimes edge (le SDK repose sur `fetch`).

## 2. Initialisation

```ts
const sp = StakPass.init({
    publishableKey: 'spk_pub_…', // ou secretKey: 'spk_live_…'
    baseUrl: 'https://api.stakpass.com', // optionnel, valeur par défaut (le SDK ajoute /core/partner/v1)
    timeoutMs: 15_000,           // optionnel
    maxRetries: 2,               // optionnel
});
```

## 3. Lecture de l'événement

| Méthode | Route | Rôle |
|---|---|---|
| `event.get()` | `GET /event` | Événement lié à la clé (l'événement vient toujours de la clé) |
| `tickets.list()` | `GET /tickets` | Billets en vente |
| `packs.list()` | `GET /ticket-packs` | Packs de billets |
| `promo.validate(code)` | `GET /promo-codes/validate` | Valide un code promo : renvoie `{ code, discountType, discountValue }`. La remise est appliquée par la commande ; le panier peut l'afficher |

## 4. Statistiques

| Méthode | Route | Rôle |
|---|---|---|
| `track.view({ referrer?, utmSource?, utmMedium?, utmCampaign? })` | `POST /view` | Compte une vue, dédupliquée par visiteur sur 30 minutes. Appelé automatiquement au chargement (désactivable). Le SDK génère le `visitorId` (64 caractères max) et lit les `utm_*` de l'URL |
| `track.share(platform)` | `POST /share` | Compte un partage, à appeler au clic de partage. `platform` : `LINK`, `WHATSAPP`, `TWITTER` ou `FACEBOOK` |

## 5. Commande

| Méthode | Route | Rôle |
|---|---|---|
| `orders.create({ buyer, tickets?, packs?, promoCode?, vendorCode? })` | `POST /orders` | Crée la commande (statut `INIT`, sans stock réservé). Renvoie `accessToken` une seule fois |
| `orders.get(id)` | `GET /orders/:id` | Statut de la commande |
| `orders.tickets(id)` | `GET /orders/:id/tickets` | Billets de la commande, disponibles une fois payée |
| `orders.receipt(id)` | `GET /orders/:id/receipt` | Reçu PDF d'une commande payée, renvoyé en `Blob`. Plan PRO/CUSTOM requis (403 `PLAN_FEATURE_UNAVAILABLE`). Le 404 `ORDER_NOT_FOUND` couvre aussi « pas encore payée » et « mauvais jeton » |
| `orders.list(params?)` | `GET /orders` | Liste des commandes de l'événement. **Serveur seulement** |
| `orders.watch(id, callback, opts?)` | `GET /orders/:id` en boucle | Polling avec backoff jusqu'à un statut final (`PAID`, `REFUND`, `CANCELLED`). Renvoie `{ stop, done }`. `waitForPayment` et `waitForTickets` en sont les raccourcis |

Acheteur (`buyer`) : obligatoire. Un compte existant est réutilisé. Un compte non vérifié est repris par code OTP.

En mode navigateur, le token de commande est stocké par commande (sessionStorage, repli en mémoire) et envoyé en `X-Order-Token` sur `get`, `pay`, `tickets` et `watch`. Un token manquant ou faux donne un 404, comme une commande inconnue.

### Helper de panier (v1)

Objet en mémoire, sans appel réseau, pour préparer une commande avant `orders.create` (`createCart()`) :
- `createCart(initial?)`, `addTicket(id, qty)`, `addPack(id, qty)`, `setTicket`, `setPack` (0 supprime la ligne), `removeTicket`, `removePack`, `clear`, `isEmpty`.
- `totals(catalog, promo?)` : `{ subtotal, discount, total }` indicatif, frais exclus, remise `FIXED` ou `PERCENTAGE`.
- `validate(catalog)` : problèmes que le backend refuserait (`EMPTY`, `TICKET_NOT_FOUND`, `PACK_NOT_FOUND`, `SALES_CLOSED`, `INSUFFICIENT_STOCK`, `QUANTITY_TOO_HIGH` au-delà de 100, `TOO_MANY_TICKETS` au-delà de 200 billets, packs développés).
- `ticketCount(catalog)` : billets reçus, packs développés.
- `toOrderItems()` : `{ tickets, packs }` à étaler dans `orders.create({ buyer, ...cart.toOrderItems() })`.

Le total du panier est indicatif. Le backend reste la référence : le montant de la commande vient de `orders.create`.

## 6. Paiement

| Méthode | Route | Rôle |
|---|---|---|
| `orders.pay(id, { provider, returnUrl? })` | `POST /orders/:id/initiate-payment` | Initie le paiement chez le fournisseur |

Helpers (sous-chemin `@stakpass/sdk/browser`) :
- **kkiapay** : charge le widget, l'ouvre, puis lance `watch` jusqu'au statut final.
- **Stripe** : redirige vers l'URL de paiement. `returnUrl` est obligatoire et doit correspondre aux sites autorisés de la clé.

## 7. Robustesse

- Timeout configurable, `AbortSignal` accepté sur chaque appel.
- Retry sur erreur réseau et sur 429 (en respectant `Retry-After`).
- Pas de retry automatique sur `orders.create` en mode navigateur (pas d'idempotence côté navigateur). En mode serveur, le retry est sûr grâce à l'`Idempotency-Key`.
- Erreurs typées : `StakPassError { code, status, message }`. Les codes sont exposés en constantes, par exemple `API_KEY_ORIGIN_NOT_ALLOWED`, `API_KEY_KIND_NOT_ALLOWED`, `API_KEY_NOT_FOUND`, `RATE_LIMITED`, `ORDER_NOT_FOUND`.
- Une clé révoquée est refusée par le backend en moins de 60 s.

## 8. Sécurité

- La clé n'apparaît jamais dans les logs ni dans les messages d'erreur du SDK.
- Une clé publiable est liée aux sites autorisés : copiée ailleurs, elle est refusée par le backend.
- Aucune lecture de données personnelles d'autres acheteurs : les commandes du navigateur ne sont lisibles qu'avec leur token.

## 9. Distribution et développement

- Types complets (entrées, réponses, enums).
- Formats : ESM, CJS, types, et un build IIFE (`window.StakPass`) pour une balise `<script>` sans bundler.
- Points d'entrée : `@stakpass/sdk` (cœur, navigateur et serveur) et `@stakpass/sdk/browser` (DOM : widget kkiapay, stockage du token).
- Outillage : pnpm, tsup, Vitest, Biome.
- Tests : matrice des deux modes avec `fetch` mocké.
- README en deux parties (navigateur, serveur) et un exemple HTML de parcours complet.

## 10. Hors v1

- Composant UI de checkout prêt à l'emploi.
- Webhook sortant signé `order.paid`.
- Clés de test (sandbox).
- Clé multi-événements.
- Plugins PHP et WordPress.

## 11. Décisions prises et points restants

- URL de base du gateway en production : `https://api.stakpass.com` (option `baseUrl`). Décidé.
- Canaux de partage : ceux du backend (`LINK`, `WHATSAPP`, `TWITTER`, `FACEBOOK`). Décidé.
- Helper de panier : dans la v1. Décidé.
- Widget kkiapay sur un domaine tiers : confirmé par le propriétaire, à revérifier en phase 8.

## 12. État d'avancement (phase 7)

Fait : client HTTP (retries, timeout, annulation), ressources, mode navigateur et serveur, token de commande, panier, polling, helpers kkiapay et Stripe, build ESM + CJS + IIFE, 41 tests, README, exemple HTML, release avec bumpp.

Écarts avec le plan initial :
- Statuts de commande réels : `INIT`, `PENDING`, `PAID`, `REFUND`, `CANCELLED` (pas de `FAILED` ni `EXPIRED`).
- Le corps de commande est `tickets` + `packs`, pas `items`.
- Bundler : tsdown à la place de tsup (tsup 9 ne génère pas les types avec TypeScript 7). Le build IIFE est `dist/stakpass.iife.js`.

Non vérifié : le widget kkiapay sur un domaine tiers, le parcours complet contre un vrai backend (phase 8). Le script `https://cdn.kkiapay.me/k.js` et les fonctions globales utilisées par le helper reprennent l'API du paquet `kkiapay` employé par le frontend ; à confirmer en navigateur.
