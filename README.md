# Henine Boutique

Storefront + admin panel for **Henine Boutique** (Boumerdès), running entirely on the Cloudflare free tier.
The full product/architecture plan is in [`PLAN.md`](PLAN.md).

```
apps/web      storefront: Preact + Vite, every page pre-rendered (Arabic at /, French at /fr)
apps/admin    Vite + React admin SPA at /admin (login: email + password + emailed code)
apps/worker   Cloudflare Worker: Hono API (/api), cron jobs, serves both static builds
packages/db   Drizzle schema, D1 migrations, seeds (69 wilayas, 1541 communes, roles)
packages/shared  phone/money/i18n utils, order state machine, zod schemas, permissions
```

## Local development

Requirements: Node ≥ 22.

```bash
npm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run db:migrate:local          # create tables in the local D1
npm run db:seed:local             # wilayas, communes, roles, settings + 6 demo products

# create your admin account (prints a one-time invitation link)
npm run admin:invite -- --email you@example.com --name "Ilyas" --role owner

npm run build                     # storefront + admin → dist/
npm run dev                       # Worker on http://127.0.0.1:8787 (site, /admin, /api)
```

Faster UI iteration: `npm run dev:web` rebuilds the store (≈ 7 s, then restart `npm run dev`), or `npm run dev:admin` (Vite on :5174, proxies `/api` to :8787).

Checks: `npm run typecheck`, `npm test`.

In development no email is sent: login codes are printed in the terminal **and shown on the login screen** (localhost only).

## Admin login

Email + password, then a 6-digit code sent by email (valid 10 min, 5 attempts). 5 wrong passwords lock the account 15 min.
The password is stretched in the browser (PBKDF2-SHA256, 600 000 iterations) and the Worker stores a salted, peppered
hash of that key, which keeps each login within the free plan's 10 ms CPU limit.
New members are invited from **Système → Équipe** (or `npm run admin:invite`).

## Telegram orders

Admin → **Système → Comptes → Telegram**:
1. Create a bot with **@BotFather** (`/newbot`), copy the token, paste it.
2. Add the bot to the team's group and send `/start` there, then click **Détecter le groupe** and pick it.
3. **Envoyer un message test**. Every new order now arrives with ✅ Confirmer / 📵 Injoignable / ❌ Annuler buttons.

Locally the buttons work while the admin panel is open (it polls Telegram). In production click **Activer les boutons** (webhook).
Bot commands: `/id` (your Telegram ID, to link it in Équipe), `/jour` (today's numbers), `/cmd HN-XXXXXX`.

## First deploy (one-time Cloudflare setup)

1. `npx wrangler login`
2. `npx wrangler d1 create henine-db --location weur` → paste the `database_id` into `apps/worker/wrangler.jsonc`
3. `npx wrangler r2 bucket create henine-media`
4. Secrets (from `apps/worker`): `npx wrangler secret put <NAME>` for `TURNSTILE_SECRET`, `IP_HASH_SALT`, `TRACK_TOKEN_PEPPER`, `AUTH_PEPPER`,
   `SETTINGS_KEY` (32 random bytes, base64) and `MAIL_API_KEY`. Optionally set `MAIL_PROVIDER` (`resend`), `MAIL_FROM` and `TURNSTILE_SITE_KEY` in `wrangler.jsonc` vars.
5. Set `PUBLIC_ORIGIN` (your `*.workers.dev` URL for now) in `wrangler.jsonc` vars.
6. `npm run migrate:remote --workspace @henine/worker`, `npm run seed:remote --workspace @henine/worker`, then `npm run deploy`
7. Create the owner: `npm run admin:invite -- --email <email> --name Ilyas --role owner --remote --origin https://<your-url>`
8. Optional extra wall: Cloudflare Access on `/admin*` (set `ACCESS_AUD` + `ACCESS_TEAM_DOMAIN`).

After that, pushes to `main` deploy automatically via GitHub Actions (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` repo secrets).

## Data notes

- **Wilayas:** 69 (loi 26-06, décret 26-206). New wilayas 59–69 carry `parent_code`, because carriers still using the 58-wilaya layout ship to the parent.
- **Shipping prices** in the seed are **estimates from Boumerdès by zone**. Replace them with the real ZR Express grid (Admin → Contenu → Livraison) before launch.
- Regenerate the geo seed with `npm run seed:geo --workspace @henine/db`.

## Licence

Initially forked from [bagisto/nextjs-commerce](https://github.com/bagisto/nextjs-commerce) (MIT, see `LICENSE.upstream.md`); the Bagisto layer has since been removed.
