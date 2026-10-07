# Henine Boutique — Master Plan

> Storefront + admin panel for **Henine Boutique** (women's clothing — robes, lingerie, pyjamas), Boumerdès, Algeria.
> Instagram: [@henine.boutique](https://www.instagram.com/henine.boutique/) · ~89K followers · "✨ L'élégance & la qualité au meilleur prix" · Livraison 69 wilayas · Ouvert 7j/7 · 🌸
> Base: fork of [bagisto/nextjs-commerce](https://github.com/bagisto/nextjs-commerce) (MIT, Next 16 / React 19 / Tailwind 4) — remote renamed to `upstream`.
> Hosting target: **Cloudflare free tier, end to end.**

---

## 0. TL;DR — the key decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | **Drop Bagisto entirely.** Keep the Next.js UI shell, replace the Laravel/GraphQL backend with a Cloudflare-native backend (Worker + D1 + R2). | Bagisto is PHP/MySQL and cannot run on Cloudflare. |
| 2 | **Storefront = Next.js static export** (`output: 'export'`), pre-rendered at build time, with small client "islands" for live data (stock, price, cart, tracking). | Workers Free gives **10 ms CPU per request**. React SSR regularly exceeds that. Static assets are **free and unlimited** and never touch the CPU limit. |
| 3 | **One Worker with Static Assets** (not classic Pages) serves storefront + admin + API + cron. | Same free static hosting as Pages, **plus** cron triggers, Durable Objects and one deploy unit. Pages Functions can't run crons. *(If you insist on Pages: same code, plus a tiny separate cron Worker.)* |
| 4 | **API = Hono on the Worker**, **D1** (SQLite) via **Drizzle ORM**, **R2** for media. | Tiny, fast, ~1–3 ms CPU per API call; fits the free tier comfortably. |
| 5 | **Images are optimised in the admin's browser before upload** (AVIF + WebP, 5 widths, blur placeholder, EXIF stripped), then stored in R2 and served from a cached custom domain. | Cloudflare Images free = only 5,000 transformations/month. Client-side encoding = **zero** cost and zero Worker CPU. |
| 6 | **Admin = separate Vite + React SPA** at `/admin`, protected by **Cloudflare Access** (Zero Trust, free ≤ 50 users) **and** JWT verification + role checks in the API. | No passwords to store/hash (hashing blows the 10 ms CPU budget), SSO/OTP + 2FA for free, defence in depth. |
| 7 | **No customer passwords.** Guest checkout by phone; tracking & loyalty by phone number + order code. | How Algerian shoppers actually buy (COD, phone-first); removes a whole attack surface. |
| 8 | **Orders → Telegram group** via bot, with inline buttons (✅ Confirmer / 📵 Injoignable / ❌ Annuler) that update the order in D1. | The team works from the phone; one tap confirms. |
| 9 | **New products appear instantly** (client-rendered fallback page) and become fully SEO-static on the next automatic rebuild (debounced, via GitHub Actions). | Best of static speed + instant publishing. |
| 10 | Upgrade path: if traffic outgrows free (≈100k API calls/day), **Workers Paid $5/mo** removes all limits; optional switch to SSR/ISR via OpenNext then. | No re-architecture needed. |

---

## 1. Cloudflare free-tier budget (verified Sept 2026)

| Resource | Free limit | Our usage strategy |
|---|---|---|
| Workers requests | 100,000 / day | Static assets **don't count**. Only `/api/*` counts. Cart is client-side (0 requests). Est. 3–5 API calls per visitor → ~20–30k visitors/day headroom. |
| Workers CPU | 10 ms / request | No SSR. No password hashing. Image work in browser. Heavy jobs chunked in cron. |
| Worker size | 64 MiB uncompressed (changed 2026-09-04) | Non-issue. |
| Subrequests | 50 / request | Cron batches ≤ 40 outbound calls (Telegram, carriers, push). |
| Cron triggers | 5 per account | 3 used (see §6.6). |
| D1 | 5 GB, **5M rows read/day, 100k rows written/day** | Indexed queries, edge-cached reads (Cache API), aggregated analytics counters (never 1 row per page view). |
| R2 | 10 GB, 1M Class A + 10M Class B ops/month, **free egress** | Pre-encoded images, immutable URLs, edge cached → R2 rarely hit. |
| KV | 100k reads/day, **1k writes/day** | Used only for rarely-written config snapshots — never for counters or rate limits. |
| Durable Objects | SQLite-backed only | Optional: per-phone/IP rate limiter + stock-lock if ever needed. |
| Queues | **Paid only** | Replaced by a D1 **outbox table** + `ctx.waitUntil()` + cron retry. |
| Images transformations | 5,000 unique / month | Not needed (client-side encoding). Kept as emergency fallback only. |
| Turnstile, WAF managed rules, Bot Fight Mode, Web Analytics, 1 rate-limit rule, Access (≤50 users) | Free | All used. |
| D1 Time Travel | 7 days PITR on free | + weekly off-site export (GitHub Actions). |

**Location:** create D1 with location hint **`weur`** (closest to Algeria). Static pages are served from the nearest Cloudflare PoP.

---

## 2. Architecture

```
                         ┌────────────────────── Cloudflare (Free) ───────────────────────┐
  📱 Client ───────────► │  Worker "henine"  (Static Assets + Hono)                          │
  (4G, mid Android)      │   ├─ /*              → prebuilt storefront HTML/CSS/JS  (free, ∞) │
                         │   ├─ /produit/<new>  → fallback shell (client-rendered) until rebuild
                         │   ├─ /admin/*        → Admin SPA            [Cloudflare Access]   │
                         │   ├─ /api/*          → public API  (Turnstile, rate-limit, zod)   │
                         │   ├─ /api/admin/*    → admin API   [Access JWT verify + RBAC]     │
                         │   ├─ /api/tg/<secret>→ Telegram webhook (secret-token header)     │
                         │   ├─ /api/carrier/*  → carrier webhooks (signed)                  │
                         │   └─ scheduled()     → outbox retry · carrier sync · reports ·    │
                         │                         rebuild-if-dirty · push drip · cleanup     │
                         │  D1  "henine-db"  (weur)      R2 "henine-media" ─► media.<domain> │
                         │  Turnstile · WAF · Bot Fight · Web Analytics · Zero Trust Access  │
                         └───────────────────────────────────────────────────────────────────┘
          ▲                                  │                         ▲
          │ inline buttons / commands        │ new order, alerts       │ build + wrangler deploy
   Telegram group (topics) ◄─────────────────┘                   GitHub Actions (on push, on
                                                                  "Publier", on dirty-catalog cron)
```

### 2.1 Monorepo layout (npm workspaces)

```
henine/
├─ apps/
│  ├─ web/        storefront: Preact + Vite, every page pre-rendered (was Next.js 16, see §15)
│  ├─ admin/      Vite + React 19 SPA (TanStack Router + TanStack Query), base '/admin/'
│  └─ worker/     Hono API, cron, Telegram bot, serves web/out + admin/dist as assets
├─ packages/
│  ├─ db/         Drizzle schema, SQL migrations, seeds (69 wilayas, communes, stop-desks)
│  ├─ shared/     zod schemas, pricing + promo engine, phone utils, order state machine,
│  │              i18n strings (fr/ar), money formatting (DZD)
│  └─ ui/         design tokens, primitives (Button, Sheet, Dialog, Skeleton, Toast…)
├─ .github/workflows/  ci.yml · deploy.yml · rebuild.yml · backup.yml · lighthouse.yml
├─ wrangler.jsonc
└─ PLAN.md
```

### 2.2 `wrangler.jsonc` (shape)

```jsonc
{
  "name": "henine",
  "main": "apps/worker/src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "dist",                       // web/out + admin/dist merged
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    "run_worker_first": ["/api/*", "/admin/*", "/produit/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "henine-db", "database_id": "…", "migrations_dir": "packages/db/migrations" }],
  "r2_buckets":   [{ "binding": "MEDIA", "bucket_name": "henine-media" }],
  "ratelimits":   [{ "name": "RL_ORDER", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } }],
  "triggers":     { "crons": ["*/5 * * * *", "*/30 * * * *", "0 20 * * *"] },
  "workers_dev": false,                        // production only on the custom domain
  "observability": { "enabled": true, "head_sampling_rate": 0.1 }
}
```
Secrets (never in git): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TURNSTILE_SECRET`, `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `IP_HASH_SALT`, `TRACK_TOKEN_PEPPER`, `GITHUB_DISPATCH_TOKEN`, `VAPID_PRIVATE_KEY`, carrier API keys, `META_CAPI_TOKEN`.

### 2.3 What we keep / remove from the cloned repo

| Keep & adapt | Remove |
|---|---|
| App Router structure, Tailwind 4, `globals.css` approach | `@apollo/client`, `graphql`, `src/graphql/**`, `src/lib/*graphql*`, `api/graphql` |
| Product grid/card, `VariantSelector`, `ImageZoom`, `Lightbox`, `Pagination`, filters UI, cart drawer UX | `next-auth`, `api/auth`, `account/**`, `customer/**` (login/register/forgot), `jwt-cookie`, `SessionManager` |
| Skeleton/shimmer components (re-skinned) | Compare, downloadable, booking, bundle, grouped product types |
| `SpeculationRules` (adapted routes) | `proxy.ts` (middleware — not supported by static export), server actions, `api/revalidate` |
| Breadcrumb, Rating, Toast, ScrollToTop | `@heroui/*` + `framer-motion` from the storefront (heavy) → CSS + View Transitions |
| `react-hook-form` (checkout) | Redux Toolkit → **Zustand** (~1 KB) for cart/favourites |
| MIT license notice (Vercel) | Bagisto branding, README, `.env.example` vars |

---

## 3. Data model (D1 / Drizzle)

All money in **integer DZD** (no decimals). All timestamps UTC epoch ms; display in `Africa/Algiers` (UTC+1, no DST). Text fields bilingual where customer-facing (`_fr`, `_ar`).

**Catalogue**
- `categories` (id, parent_id, slug, name_fr, name_ar, image, sort, is_active, seo_*)
- `collections` (Nouveautés, Best-sellers, Promo…; manual or rule-based)
- `products` (id, slug, name_fr/ar, description_fr/ar (markdown), status `draft|published|scheduled|archived`, publish_at, category_id, tags, base_price, compare_at_price, cost_price, size_guide_id, video_key, instagram_url, seo_*, created_by, updated_at)
- `product_images` (product_id, color_value?, r2_base_key, widths JSON, thumbhash, alt_fr/ar, sort)
- `product_options` (Taille, Couleur) · `option_values` (label_fr/ar, hex for colours)
- `variants` (id, product_id, sku, barcode, option_values, price_override, stock_on_hand, stock_reserved, low_stock_threshold, weight_g, is_active)
- `stock_movements` (variant_id, delta, reason `reception|vente|retour|ajustement|casse|reservation|liberation`, ref_order_id, note, actor, at)
- `size_guides` (name, table JSON, tips)

**Commerce**
- `wilayas` (code 1–69, name_fr, name_ar, is_active, home_price, desk_price, delay_days, free_shipping_threshold?) — **data-driven, editable** (Algeria moved to 69 wilayas; never hard-code).
- `communes` (wilaya_code, name_fr, name_ar, is_active, home_supported)
- `carriers` (Yalidine / ZR Express / Noest / Maystro / EcoTrack-based…, adapter, credentials_ref, is_default)
- `stop_desks` (carrier_id, wilaya_code, commune, name, address, gps)
- `customers` (id, phone **unique normalized** `05xxxxxxxx`, name, wilaya, commune, address, tags, notes, is_blacklisted, blacklist_reason, orders_count, delivered_count, returned_count, cancelled_count, total_spent, points_balance, tier, referral_code, first_order_at, last_order_at)
- `orders` (id, **public_code** `HN-7K3P9` (Crockford base32), **track_token_hash**, status, channel `web|express|instagram|whatsapp|boutique|telephone`, customer_id, snapshot name/phone/wilaya/commune/address, delivery_type `domicile|bureau`, stop_desk_id, subtotal, discount_total, shipping_price, total, coupon_code, points_used, points_earned, payment_method `cod|chargily|baridimob`, payment_status, carrier_id, tracking_number, label_url, assigned_to, confirm_attempts, next_callback_at, customer_note, internal_note, utm_*, referrer, ip_hash, ua_short, idempotency_key **unique**, risk_score, created_at, confirmed_at, shipped_at, delivered_at, returned_at)
- `order_items` (order_id, variant_id, snapshot name/sku/options/image, unit_price, qty, line_discount)
- `order_events` (order_id, from_status, to_status, actor (team member / telegram user / system / carrier), source `admin|telegram|carrier|system`, note, at)
- `carts` (id, items JSON, phone?, name?, wilaya?, value, step, consent, recovered_order_id, updated_at) — only saved once the client types a phone at checkout (with consent).

**Marketing**
- `coupons` (code, type `percent|fixed|free_shipping`, value, min_subtotal, applies_to (products/categories), wilayas?, first_order_only, per_customer_limit, usage_limit, used_count, starts_at, ends_at, is_active, influencer_name, commission_pct)
- `promotions` (automatic: `category_percent`, `buy_x_get_y`, `bundle_price`, `free_shipping_over`, `flash_sale` with countdown; priority; stackable)
- `loyalty_rules` (singleton: points_per_100da, redeem_rate, min_redeem, expiry_days, tiers JSON, referral_bonus) · `loyalty_ledger` (customer_id, delta, reason, order_id, actor, at)
- `reviews` (product_id, order_id?, name, rating, text, photos, verified, status `pending|approved|rejected`, reply, is_featured, created_at)
- `home_blocks` (type, config JSON, sort, starts_at, ends_at, is_active) — see §5.3
- `links` (link-in-bio items + short links: slug, target, label, icon, sort, clicks) · `link_clicks_daily`
- `push_subscriptions` (endpoint, keys, locale, segment tags, created_at) · `campaigns` (push/announcement/popup, segment, schedule, status, stats)
- `stock_alerts` ("Prévenez-moi" waitlist: variant_id, phone?/push_sub_id, notified_at)
- `contact_messages` (name, phone, subject, message, status, handled_by)

**Content & system**
- `pages` (slug, title_fr/ar, body_fr/ar, seo) — À propos, CGV, Confidentialité, Livraison & retours, FAQ
- `settings` (key/value JSON: store info, contact, hours, socials, pixels, announcement bar, maintenance mode…)
- `message_templates` (WhatsApp/Telegram templates with variables)
- `redirects` (from, to, code)
- `team_members` (email, name, role_id, telegram_user_id, phone, is_active, last_seen_at) · `roles` (name, permissions JSON)
- `audit_log` (actor, action, entity, entity_id, diff JSON (PII-masked), ip_hash, at)
- `error_events` (fingerprint, source `client|api|cron|telegram|carrier`, message, stack (scrubbed), url, count, first_seen, last_seen, status) · `not_found_log` (path, count, last_seen, referrer)
- `outbox` (kind `telegram|carrier|push|capi|rebuild`, payload, attempts, next_attempt_at, last_error, done_at)
- `analytics_daily` (date, metric, dim, value) — aggregated counters (views per product, add-to-cart, checkout_start, orders by source/wilaya/hour…)
- `rate_hits` (key, window, count) — fallback limiter

**Indexes:** `orders(status, created_at)`, `orders(customer_id)`, `orders(public_code)`, `customers(phone)`, `variants(product_id)`, `products(status, category_id)`, `analytics_daily(date, metric)`, `outbox(done_at, next_attempt_at)`.

---

## 4. Storefront (customer website)

### 4.1 Pages (FR at `/`, AR at `/ar/…`, RTL)
| Route | Content |
|---|---|
| `/` | Homepage built from admin blocks (§5.3) |
| `/c/[slug]` | Category/collection: sticky filter chips (taille, couleur, prix, promo), sort, 2-col mobile grid, infinite "Voir plus" |
| `/produit/[slug]` | Gallery (swipe, pinch-zoom, video reel), price + promo badge, colour swatches, size chips with stock hints ("Plus que 2 !"), size guide sheet, **Commande express** form inline, add-to-cart, delivery estimate for the chosen wilaya, reviews, "Vous aimerez aussi", sticky bottom CTA |
| `/panier` | Also available as a bottom sheet from anywhere |
| `/commande` | One-page checkout (§4.3) |
| `/merci/[code]` | Confirmation + tracking link + "Enregistrer / Partager sur WhatsApp" |
| `/suivi` & `/suivi/[code]` | Order tracking (§4.4) |
| `/favoris` | Wishlist (local, no account) |
| `/fidelite` | Check points by phone + last order code; referral link |
| `/recherche` | Instant client-side search |
| `/liens` | Link-in-bio page for Instagram (managed in Marketing → Liens) |
| `/l/[slug]` | Short links with UTM + click counting (Worker redirect) |
| `/avis/[token]` | Verified review form sent after delivery |
| `/contact`, `/p/[slug]` | Contact form (Turnstile), static content pages |
| `/404` | Branded, with search + best-sellers; misses are logged |

### 4.2 UX principles (phone-first)
- Designed at **360×740** first, then scaled up. Thumb zone: primary CTAs in a **sticky bottom bar**; bottom nav (Accueil · Catégories · Recherche · Favoris · Panier).
- Tap targets ≥ 44px, inputs ≥ 16px (no iOS zoom), `inputmode="tel"` for phone, native `<select>` for wilaya/commune on mobile (fast, accessible) with search on desktop.
- **Commande express on the product page.** This is the dominant conversion pattern in Algerian e-commerce: name, phone, wilaya, commune, domicile/bureau, then *Commander*. No cart detour.
- Prices always **"xx xxx DA"**, shipping price shown as soon as the wilaya is picked, clear "💵 Paiement à la livraison".
- Trust strip: *Livraison 69 wilayas · Paiement à la livraison · Échange possible · Boutique à Boumerdès 7j/7*.
- Lingerie: discreet packaging note, model-free flat-lay option, size advice.
- Arabic: full RTL mirror using Tailwind logical utilities (`ms-*`, `pe-*`, `start-*`), Arabic numerals choice (Western digits recommended for phone/prices).

### 4.3 Checkout (single page, < 30 s)
1. Nom et prénom
2. Téléphone: validated as Algerian mobile `0[5|6|7]XXXXXXXX`; accepts `+213…`/spaces; normalized.
3. Wilaya (69) → Commune (filtered) → **À domicile** (address field) or **Stop-desk / bureau** (office list for the carrier)
4. Note (optional), coupon field (collapsed), points toggle (if phone has points).
5. Summary: items, subtotal, remise, livraison, **Total**.
6. Invisible **Turnstile** token, then **Commander** (sticky). Double-submit protection via `idempotency_key` (UUID generated when the page loads).
- Server recomputes **everything** (prices, promos, shipping, points). The client is never trusted.
- Cart autosaved (after phone + consent) → powers **Paniers abandonnés**.
- Offline/poor network: request retried with the same idempotency key; the service worker queues it with Background Sync where supported.

### 4.4 Order tracking — "easiest way possible"
Three ways in, no account, no password:
1. **Automatic:** after ordering, the order is saved on the device (`localStorage`). A small "📦 Ma commande: *Expédiée*" pill appears in the header on every return visit. Tap it for the timeline.
2. **Link:** `/suivi/HN-7K3P9?t=<token>` shown on the thank-you page, with a one-tap **"Envoyer sur WhatsApp"** button (the customer sends it to herself) and included in the confirmation WhatsApp message the team sends.
3. **Phone number only:** `/suivi` asks for the phone number. It shows her recent orders with **status, date, item thumbnails and wilaya only**. The address and full name are hidden unless she also has the order code or token. Protected by Turnstile + rate limit, so this lookup can't be used to harvest customer details.

Timeline: *Reçue → Confirmée → En préparation → Expédiée (n° de suivi + transporteur) → En livraison → Livrée* (or *Retour*). Carrier statuses are synced automatically (§6.5). Optional extra: a **Telegram deep link** `t.me/<bot>?start=<code>` to get status updates for free.

### 4.5 Performance targets & "perfect loading scenes"
| Metric (mid-range Android, 4G, CPU ×4 throttled) | Budget |
|---|---|
| LCP | < 1.8 s (home & PDP) |
| INP | < 150 ms |
| CLS | < 0.02 |
| JS on first load (gz) | < 90 KB storefront, admin lazily split |
| HTML (gz) | < 30 KB |
| Lighthouse mobile | ≥ 95 all categories (enforced in CI) |

How:
- **Static HTML at the edge**, immutable hashed assets (`Cache-Control: public, max-age=31536000, immutable`).
- **Images:** `<picture>` with AVIF → WebP, `srcset` 320/480/720/1080/1440, explicit `width/height`/`aspect-ratio`, LCP image `fetchpriority="high"` + preload, everything else lazy. **ThumbHash** placeholder (≈25 bytes in the HTML) → blur-up fade-in.
- **Fonts:** self-hosted, subset (Latin + Arabic), `woff2`, 1 display face (e.g. *Cormorant Garamond* / *Playfair Display*) + 1 text face (*DM Sans*) + Arabic (*IBM Plex Sans Arabic* / *Tajawal*), `font-display: swap`, metric-matched fallbacks (no layout shift).
- **Loading scenes:** skeletons that match the final layout exactly (same boxes, same aspect ratios), shimmer in brand blush tones, **View Transitions** (product card image morphs into the product page hero), a thin top progress bar on navigation, optimistic add-to-cart with a "fly to cart" animation and haptic `navigator.vibrate(10)`, 🌸 logo bloom micro-animation. **No blocking splash screen**, because splash screens hurt LCP.
- **Speculation Rules** prerender on hover/touchstart (existing component, adapted).
- **Live data:** one batched call `GET /api/live?v=ids…` for stock/price, cached at the edge 60 s (Cache API), so thousands of visitors cost only a handful of D1 reads.
- **Search:** tiny prebuilt index (MiniSearch) shipped as a static JSON and loaded on first focus. It handles French accents, Arabic normalisation (alef/ya/ta-marbuta, tashkeel removal) and typos. Instant, zero server cost.
- **PWA:** manifest, installable, service worker (shell + stale-while-revalidate images, offline page, queued order submit).
- Third-party pixels (Meta/TikTok) loaded **after idle + consent**; conversions also sent server-side (CAPI) so no data is lost.

### 4.6 SEO & sharing
Static HTML, `sitemap.xml`, `robots.txt`, canonical + `hreflang` fr/ar, JSON-LD (`Product`/`Offer` in **DZD** with availability, `AggregateRating`, `BreadcrumbList`, `Organization`, `LocalBusiness` Boumerdès), per-product OG image (1200×630 crop generated at upload), redirects table, 404 logging.

---

## 5. Admin panel (`/admin`)

**Stack:** Vite + React 19 + TanStack Router/Query + Tailwind 4 + shared `ui` package; charts with a light lib (uPlot / Recharts lazy-loaded); forms with react-hook-form + zod (shared schemas with the API).

**Phone-first shell:**
- Mobile: bottom tab bar **Accueil · Commandes · Produits · Clients · Plus**; "Plus" opens the full section menu. Swipe actions on list rows (→ Confirmer, ← Appeler), pull-to-refresh, big buttons, camera upload, barcode scanning (`BarcodeDetector`), dark mode, installable PWA.
- Desktop/tablet: collapsible sidebar with the exact grouping below, ⌘K command palette, keyboard shortcuts, multi-select bulk actions.
- Every list: search, filters saved as views, CSV export, skeleton loading, empty states, optimistic updates with undo toasts.
- Everything written → `audit_log`. Permission-gated per role (§5.6 Équipe).

### 5.0 Tableau de bord (home)
Today at a glance: new orders (to confirm), revenue today/7d/30d, confirmation rate, orders to call back now, parcels in transit, returns to process, low-stock items, pending reviews/messages, top products today, build/publish status. Every tile links to a filtered view.

### 5.1 Catalogue
**Produits**
- Grid/list, filters (catégorie, statut, stock, tag, promo), bulk: publier/masquer, changer catégorie, prix ±% / fixe, ajouter tag, dupliquer, supprimer (soft).
- Editor (mobile-optimised sections): titles & descriptions FR/AR (markdown with preview), slug auto, category/collections/tags (*Nouveauté, Best-seller, Exclusivité*), options **Taille × Couleur → variant matrix generator** (bulk price/stock fill), prix, prix barré, **prix d'achat → marge %** (hidden for roles without `cost.view`), SKU/barcode auto-generation, weight, size guide, video reel, Instagram post link, related products, SEO + live Google/WhatsApp preview, schedule publish.
- **Photos:** drag-drop or camera, reorder, assign to colour, crop presets (4:5 product, 1:1, 9:16 story). The browser encodes **AVIF + WebP × 5 widths + ThumbHash** (jSquash WASM in a Web Worker), strips EXIF/GPS, then uploads straight to R2 via the admin API. Auto alt-text template.
- Import/export CSV; print barcode labels (thermal 40×30 mm).

**Stock**
- Variant table: on hand / reserved / available, inline ± with reason, colour/size matrix view.
- Movement ledger (who, what, why, linked order), low-stock thresholds → Telegram alert, out-of-stock list, **demand signal** ("12 clientes attendent" from waitlists), stock valuation (cost × qty).
- **Inventaire mode:** scan barcodes with the phone camera and count, then see the variance report and apply it.
- Réception de marchandise (supplier delivery) with cost update.

**Ventes**
- Sales performance per product/variant/category/period: units, revenue, margin, return rate, sell-through, slow movers, "size curve" (which sizes sell → buy better).
- **Vente manuelle** (POS-lite): record sales made in the Boumerdès boutique or via Instagram DM / phone. This decrements stock, attaches the customer (by phone) and tags the channel, so *all* revenue lives in one system.

### 5.2 Commandes
**Commandes**
- Status tabs with counters: *Nouvelles · À rappeler · Confirmées · En préparation · Expédiées · Livrées · Retours · Annulées*; search by phone/code/name; filters wilaya, date, channel, carrier, assignee, coupon.
- Order sheet: timeline (`order_events`), **customer risk badge** (delivered vs returned history, blacklist, duplicates in 24 h), one-tap **📞 Appeler** / **WhatsApp** (templated message with tracking link), edit items/qty/variant/address/delivery type (totals recomputed server-side), confirmation attempts (*Injoignable 1/2/3* → auto callback reminder), assign to a confirmatrice, internal notes.
- **Expédier:** push the parcel to the carrier API → tracking number + label PDF; bulk print labels & packing slips (A4 or thermal).
- State machine (enforced in `packages/shared`):
  `nouvelle → confirmée | injoignable | annulée | doublon | fausse` · `confirmée → en_preparation → expédiée → en_livraison → livrée | retour` · `retour → retour_reçu` (stock re-added after inspection).
  Stock is **reserved** at `nouvelle`, released on `annulée/doublon/fausse`, and committed at `expédiée`.
- Duplicate detection and merge, CSV export, manual order creation (phone/Instagram orders).

**Clients**
- List with segments: *VIP, Fidèles, Nouvelles, Inactives 60j, À risque (retours), Blacklist*; profile: orders, total spent, delivery success %, points & ledger, tags, notes, addresses used; blacklist with reason (blocks ordering or forces manual review); merge duplicates; export a segment (e.g. to copy phone numbers for a WhatsApp broadcast list).

**Paniers**
- Live and abandoned carts (captured at checkout after the phone is entered, with consent): value, items, wilaya, time. One-tap **Relancer sur WhatsApp** (prefilled message + cart-restore link, optional auto-coupon). Recovery rate stats.

**Promos**
- Coupon codes (%/fixed/free shipping) with conditions: min amount, products/categories, wilayas, first order only, per-phone limit, total uses, dates.
- Automatic promotions: category %, *2 achetés = 1 offert*, bundles/packs, free shipping above X DA, **flash sales** with a site-wide countdown.
- Influencer codes with attribution and commission report; stacking/priority rules; promo preview simulator ("what would this cart cost?").

**Fidélité**
- Rules: X points per 100 DA **on delivered orders only** (delivery effectively verifies the phone), redemption value, minimum, expiry, tiers (*Rose → Or → Diamant*) with perks (free shipping, early access), birthday bonus (optional date).
- **Parrainage:** each customer gets a referral code/link; both earn points when the referee's first order is *livrée*.
- Manual adjustments with reason (ledger), leaderboard, liability report (outstanding points in DA).

### 5.3 Marketing
**Page d'accueil**: block builder with drag-to-reorder and a **live phone-frame preview**:
hero slider (separate mobile/desktop crops, image or video, CTA), announcement bar (rotating messages), category tiles, product carousels (manual or rule: nouveautés / best-sellers / promo / by tag), "Reels" strip (short videos), countdown banner, featured reviews, trust badges, Instagram CTA, free HTML/markdown block. Each block has start/end scheduling. **Publier** triggers a rebuild (≈2–4 min, status shown live).

**Avis**: moderation queue (approve/reject/reply/feature), **verified purchase** badge (the review link is sent after *livrée*), photo reviews, rating distribution, "request reviews" batch (generates WhatsApp messages for recently delivered orders), Telegram alert on new review.

**Notifier**: customer notifications:
- **Web Push** campaigns (PWA subscribers): segment, schedule, deep link, image; sent in batches by cron (subrequest limits respected), with delivery/click stats.
- **"Prévenez-moi"** back-in-stock waitlists → automatic notification when stock is replenished.
- Site **announcement bar / popup** campaigns (e.g. "-20% ce week-end") with scheduling and frequency capping.
- WhatsApp broadcast helper: export segment + message template (no paid API needed).

**Liens**: **link-in-bio** page builder for Instagram (`/liens`: buttons, featured products, WhatsApp, TikTok, Maps location, promo code), **short links** `/l/ete25` with auto-UTM and click stats per link/day, **QR code** generator for the boutique, packaging and flyers.

**Contact**: inbox of contact-form messages (status, assignee, reply via WhatsApp/tel link), plus store contact settings (phones, WhatsApp, Instagram, TikTok, Facebook, address in Boumerdès, opening hours 7j/7, Google Maps link), shown site-wide.

### 5.4 Analyse
**Statistiques**
- KPIs with period comparison: CA, commandes, panier moyen, **taux de confirmation**, **taux de livraison**, **taux de retour**, estimated net margin (revenue − cost − shipping − returns).
- Funnel: visites → vues produit → ajouts panier → début checkout → commandes → confirmées → livrées.
- **Algeria map by wilaya** (orders, revenue, return rate). Useful for deciding where to push ads and where to require confirmation.
- Sources: UTM, short links, influencer codes, referrers (Instagram/TikTok/Facebook/direct); device split.
- Top/flop products, size curve, **orders by hour/day of week** (best time to post on Instagram), repeat-customer rate & cohorts, confirmatrice performance (volume, confirm rate, time-to-confirm), carrier performance (delay, returns per wilaya).
- Traffic numbers come from **Cloudflare Web Analytics** (free, cookieless) via its GraphQL API; commerce metrics come from D1. CSV export.

### 5.5 Système
**Équipe**: members (email, name, role, Telegram user ID for bot actions). Roles with a permission matrix:
| Rôle | Typical rights |
|---|---|
| Propriétaire | Everything, incl. costs, team, integrations, exports |
| Gérante | All operations; no team/integration management |
| Confirmatrice | Orders (confirm/edit/call), customers read, carts |
| Préparation / Stock | Orders `en_preparation → expédiée`, stock, labels |
| Marketing | Home page, promos, reviews, notifier, liens, stats (no costs) |
| Lecture seule | Dashboards only |
Inviting a member adds their email to the Cloudflare Access group through the Cloudflare API, so there's one place to manage access. Deactivating a member revokes it immediately.

**Comptes** *(interpreted as accounts & integrations; tell me if you meant something else)*: store identity (name, logo, favicon, colours, languages, currency), **Telegram bot** (status, group/topic IDs, test message, event → topic routing), **carrier accounts** (API keys, default carrier per wilaya, stop-desk sync), **Meta Pixel + Conversions API**, TikTok Pixel, Google Search Console verification, Chargily Pay (phase 2), Cloudflare/GitHub tokens for publish. Secrets are write-only in the UI (shown as `••••1234`), stored as Worker secrets or encrypted in D1 (AES-GCM with a Worker secret key). My security: active Access sessions, sign-out everywhere.

**Contenu**: static pages (À propos, CGV, Confidentialité, Livraison & retours, FAQ), **size guides**, **Livraison** (69 wilayas × domicile/bureau prices, delays, active flags, communes, stop desks, free-shipping rules), UI translations FR/AR, global SEO (titles, OG image), WhatsApp/Telegram message templates, **media library** (R2 browser, find unused images), redirects, maintenance/vacation mode.

**Erreurs**: grouped error feed (client JS errors via `window.onerror`/`unhandledrejection` beacon (sampled, PII-scrubbed), API exceptions, cron failures, failed Telegram/carrier/push calls from the outbox with a **Réessayer** button), 404 log (→ one-click redirect), security events (Turnstile failures, rate-limit hits, denied admin calls), audit-log viewer. New error types → Telegram "Erreurs" topic.

### 5.6 Extra modules ("and more")
- **Publier**: build status, last deploy, "Publier maintenant", auto-publish when the catalogue is dirty.
- **Sauvegardes**: weekly D1 export status, one-click export (CSV/JSON) of orders/customers/products.
- **Journal d'audit**: who changed what, with diffs.
- **Mode vacances**: storefront banner + disable ordering (or accept with a delayed-shipping notice).

---

## 6. Backend (Worker API)

### 6.1 Public API
| Method & path | Purpose | Protection |
|---|---|---|
| `GET /api/live?v=…` | stock + current price for variant IDs | edge cache 60 s |
| `GET /api/product/:slug` | fallback data for not-yet-built products | edge cache 60 s |
| `POST /api/quote` | server-side cart pricing (promos, shipping, points) | rate limit |
| `POST /api/orders` | create order | Turnstile + rate limit (IP & phone) + idempotency + zod |
| `POST /api/carts` | save checkout-in-progress (abandoned carts) | rate limit, consent flag |
| `POST /api/track` | lookup by phone / code (+token) | Turnstile + rate limit, masked output |
| `POST /api/loyalty` | points lookup by phone + order code | Turnstile + rate limit |
| `POST /api/reviews` | submit review (token for verified) | Turnstile |
| `POST /api/contact`, `/api/stock-alert`, `/api/push/subscribe` | forms | Turnstile + rate limit |
| `POST /api/e` | batched analytics beacon → aggregated counters | sampling, size cap |
| `POST /api/log` | client error beacon | sampling, dedupe, size cap |
| `GET /l/:slug` | short-link redirect + click count | — |

### 6.2 Order creation (≈2–4 ms CPU)
1. zod-validate → normalize phone → verify Turnstile (subrequest, I/O not CPU) → rate-limit checks.
2. Load variants/promos/wilaya pricing (1–3 indexed reads) → recompute totals in `packages/shared/pricing`.
3. **One D1 `batch()`** (transactional): conditional stock reservation `UPDATE variants SET stock_reserved = stock_reserved + ? WHERE id = ? AND stock_on_hand - stock_reserved >= ?` (aborts if any line fails), upsert customer, insert order + items + event + outbox rows, increment coupon usage.
4. Return `{ code, token }` → client stores for tracking.
5. `ctx.waitUntil()`: send Telegram message, Meta CAPI event. Failures stay in `outbox` → cron retries with exponential backoff.
6. Risk scoring: blacklist, returns history, duplicate order in 24 h, many orders from the same IP. High-risk orders are flagged ⚠️ in Telegram & admin (never silently dropped).

### 6.3 Telegram bot
- Group with **Topics**: 🛍 Commandes · 📦 Stock · ⭐ Avis & messages · 📊 Rapports · 🚨 Erreurs.
- New order message:
  ```
  🛍 Nouvelle commande HN-7K3P9  (site • express)
  👤 Amina B. · 📞 0550 12 34 56  ⚠️ 1 retour / 3 cmd
  📍 16 - Alger › Bab Ezzouar · 🏠 Domicile
  • Robe satin Nour — Rose / M × 1 … 4 900 DA
  • Pyjama Lina — L × 2 …………… 5 600 DA
  🚚 Livraison 600 DA · 🏷 ETE10 −1 050 DA
  💰 Total 10 050 DA (paiement à la livraison)
  [✅ Confirmer] [📵 Injoignable] [❌ Annuler] [🔗 Ouvrir]
  ```
  Button presses → webhook → verify `X-Telegram-Bot-Api-Secret-Token` (constant-time) → check the Telegram user ID belongs to an active team member with the right permission → update order + `order_events` (actor = that member) → **edit the message** to show "✅ Confirmée par Sarah à 14:32".
- Commands (team only): `/jour` (today's stats), `/cmd HN-7K3P9`, `/stock SKU`, `/rappels` (callbacks due).
- Scheduled: daily report 21:00 Algiers (orders, CA, confirm/return rates, top products), low-stock digest, callback reminders.
- Optional customer side: `t.me/<bot>?start=<code>_<token>` subscribes the customer to status updates (free).
- Limits handled: 429 `retry_after` respected, ≤ 20 msgs/min per group via outbox pacing.

### 6.4 Admin API security
Every `/api/admin/*` request: verify the **`Cf-Access-Jwt-Assertion`** JWT (RS256 signature against the team's JWKS (cached), `aud`, `iss`, `exp`) → map email → active `team_member` → check the route's permission → handle → write `audit_log`. Also require `Origin` = own domain and `Content-Type: application/json` on mutations (CSRF defence), and return `Cache-Control: no-store`.

### 6.5 Carriers (adapter pattern)
`CarrierAdapter { quote?, createParcel, getLabel, getStatus, parseWebhook, listStopDesks }` with adapters for **Yalidine** (+Guepex), **ZR Express**, **Noest**, **Maystro**, **EcoTrack-based** carriers. Start with the carrier(s) Henine actually uses. Status via webhooks where offered (signature verified), else cron polling of in-transit parcels every 30 min (≤ 40 per run). Carrier statuses map onto our state machine and update the customer tracking page automatically.

### 6.6 Cron jobs (3 triggers)
| Cron | Jobs |
|---|---|
| `*/5 * * * *` | outbox retry · callback reminders · push campaign drip · publish scheduled products/blocks · **rebuild if catalogue dirty** (GitHub `repository_dispatch`, debounced) · back-in-stock notifications |
| `*/30 * * * *` | carrier status sync · abandoned-cart marking · cache warm-up |
| `0 20 * * *` (21:00 Algiers) | daily Telegram report · analytics rollups · purge old IP hashes/UA (90 d) · expire points · error digest |

### 6.7 Media (R2)
- Admin API issues upload slots: key = `p/<productId>/<contentHash>-<w>.<avif|webp>`. The Worker validates size (≤ 2 MB per file), MIME **and magic bytes** (AVIF/WebP/JPEG/MP4/WebM only, **no SVG**), then `MEDIA.put()` with `Cache-Control: public, max-age=31536000, immutable`.
- Served from `media.<domain>` (R2 custom domain + Cache Rule "cache everything", edge TTL 1 year). Content-hashed names mean nothing ever needs purging.
- Videos: ≤ 15 MB, 720p H.264 MP4 + poster; `preload="none"`, played on visibility.

---

## 7. Security — all layers

**Edge / Cloudflare**
- Custom domain proxied; **HSTS** (preload), TLS ≥ 1.2, Always HTTPS, `workers_dev: false`, preview URLs protected by Access.
- WAF free managed rules, **Bot Fight Mode**, the free **rate-limiting rule** on `POST /api/orders`, block non-GET methods on static paths, optional geo-challenge for non-DZ traffic on `/api/orders` (tunable; diaspora customers exist).
- **Cloudflare Access** on `/admin*` and `/api/admin*`: email OTP or Google login (enforce 2FA at the Google side), session 12–24 h, optional country/device rules.

**Application**
- zod validation on every input (shared schemas), Drizzle parameterized queries (no string SQL), output encoding by React, markdown rendered with a strict allow-list sanitizer.
- Server-side price/promo/shipping/points recomputation; idempotency keys; conditional stock updates inside transactional batches.
- Turnstile on every public write endpoint; Workers Rate Limiting binding + D1 fallback counters per IP-hash and per phone.
- Tracking/review tokens: 128-bit random, only **SHA-256 (peppered) hashes** stored; public codes are non-sequential.
- Telegram and carrier webhooks: secret header / signature, constant-time compare, replay window.
- RBAC + audit log for every admin write; cost prices and exports permission-gated.
- Uploads: allow-list + magic-byte check + size limit + random keys + `nosniff`; images re-encoded in the browser, which strips EXIF/GPS.
- No customer passwords, no sessions to steal on the storefront. The cart lives in `localStorage` and never holds secrets.

**Headers** (via `_headers` for static + Worker for API/admin)
- `Content-Security-Policy`: storefront gets **per-page SHA-256 hashes** of Next's inline scripts, computed by a post-build script into `_headers`; admin needs no nonces: the Vite build emits no inline scripts, so the Worker serves `script-src 'self'`. Because `_headers` is capped at 100 rules, storefront hashes go into a per-page `<meta http-equiv="Content-Security-Policy">` injected post-build. Allow-list: self, `media.<domain>`, `challenges.cloudflare.com`, Meta/TikTok only after consent. `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera only for `/admin`), `Cross-Origin-Opener-Policy: same-origin`.
- CORS: same-origin only; the API rejects foreign `Origin`s.

**Data & privacy (Algerian Law 18-07, ANPDP)**
- Minimal PII, privacy notice FR/AR, explicit consent checkbox (cart saving, marketing push), ANPDP declaration to file, right of access/deletion via Contact.
- IPs stored only as salted hashes, purged after 90 days; PII scrubbed from logs/errors; Telegram messages can mask the address (setting).
- Backups: D1 Time Travel (7 days) + weekly encrypted `wrangler d1 export` by GitHub Actions to a private location; restore drill documented.

**Supply chain & ops**
- Lockfile, Renovate/Dependabot, `npm audit` + CodeQL in CI, minimal dependencies, secrets only in Wrangler/GitHub secrets, `.dev.vars` git-ignored, branch protection, least-privilege Cloudflare API tokens (one per purpose).
- Pre-launch: OWASP ZAP baseline scan, manual checklist (IDOR on `/api/track`, price tampering, coupon abuse, stock race, XSS in reviews, webhook spoofing).

---

## 8. Design direction

- Mood: **soft, feminine, premium but accessible**, true to "élégance & qualité au meilleur prix" and the 🌸 motif. Palette: warm ivory background, deep plum/ink text, blush-rose accent, gold hairlines for promos; dark mode for the admin (storefront light by default).
- Photography does the work: 4:5 product crops, generous whitespace, editorial serif headings + clean sans body, Arabic typeface matched in weight.
- Motion: 150–250 ms, ease-out, respects `prefers-reduced-motion`.
- Accessibility: WCAG 2.2 AA contrast (blush text on ivory must be checked), visible focus, labels on all inputs, RTL-correct.
- Brand kit needed from the boutique: logo (SVG), colours, 20–30 good product photos to design against.

---

## 9. Quality & tooling

- **Unit (Vitest):** pricing/promo engine, phone normalization, state machine, loyalty math, carrier status mapping, CSP hash script.
- **Integration:** Worker + local D1 via `wrangler dev` / `@cloudflare/vitest-pool-workers` (orders, stock races, idempotency, Telegram webhook, RBAC).
- **E2E (Playwright):** mobile viewports (Galaxy A-series, iPhone SE, Pixel), RTL, slow-4G + CPU ×4: browse → express order → Telegram (mocked) → confirm → track.
- **Lighthouse CI** with budgets (§4.5) blocking merges; bundle-size check.
- **CI/CD (GitHub Actions):** lint · typecheck · test · build web + admin · merge into `dist` · compute CSP hashes · `wrangler d1 migrations apply` · `wrangler deploy`. Preview environment with its own D1/R2 (`henine-db-preview`).
- Observability: Workers Logs (sampled), our `error_events`, Telegram error topic.

---

## 10. Roadmap (build order)

| Phase | Deliverables | Done when |
|---|---|---|
| **0. Foundation** | Monorepo; move the clone into `apps/web`; strip Bagisto/Apollo/next-auth/HeroUI; static export working; Worker + D1 + R2 + wrangler; Drizzle schema + migrations; seed 69 wilayas/communes; CI pipeline; domain on Cloudflare | `wrangler deploy` serves a static "hello" storefront + `/api/health` |
| **1. Storefront core** | Design system, home (static blocks), category, product page, cart sheet, **one-page checkout + commande express**, order API, **Telegram new-order message**, thank-you + tracking link, FR/AR | A real order placed on a phone lands in the Telegram group |
| **2. Admin core** | Access + RBAC, dashboard, **Commandes** (full workflow + Telegram buttons), **Produits** (with in-browser image pipeline), **Stock**, Livraison settings, Publier/rebuild | The team runs daily operations from the admin + Telegram |
| **3. Tracking & delivery** | `/suivi` (3 ways), carrier adapter #1 (+ labels, webhooks/sync), status timeline, WhatsApp templates | Customer sees carrier status without calling |
| **4. Growth** | Clients, Paniers, Promos, Fidélité + parrainage, Avis, Page d'accueil builder, Liens, Contact, Notifier (push + waitlist) | Marketing runs without developer help |
| **5. Insight & system** | Statistiques, Ventes (+ vente manuelle), Équipe, Comptes/integrations, Contenu, Erreurs, audit log, backups, Meta CAPI | Owner sees the full business in one place |
| **6. Hardening & launch** | CSP hashes/nonces, pen-test checklist, ZAP, Lighthouse ≥ 95, load test on API, content migration (products from Instagram), staff training, go-live, Instagram bio → `/liens` | Launch 🌸 |
| **Later** | Chargily Pay (CIB/Edahabia) with signed webhooks, BaridiMob transfer proof upload, 2nd carrier, EN locale, Workers Paid + OpenNext ISR if traffic demands | — |

---

## 11. Decisions

**Answered (2026-09-30)**
| # | Topic | Decision |
|---|---|---|
| 1 | Domain | Start free on `henine.<account>.workers.dev`. Buy a `.com` later (~$10/yr at cost via Cloudflare Registrar; no .com is free). Until then: Access protects the workers.dev host; media are served through R2 on a custom domain once one exists. |
| 2 | Carrier | **ZR Express** only (origin Boumerdès, wilaya 35). ZR's public calculator still lists 58 wilayas → wilayas 59–69 store `parent_code` and ship under the parent. |
| 3 | Shipping prices | ZR's public price API returned nothing, so the seed has **zone estimates** (400–1,400 DA home / 300–900 DA desk) flagged `shipping.prices_verified = false`. Replace with Ilyas's ZR merchant grid, or sync through the ZR/Procolis `tarification` API once API keys exist. |
| 4 | Languages | **French + Arabic** from launch. |
| 5 | Team | Owner: **Ilyas**. Rest of the team: *pending*. |
| 6 | Brand assets | Instagram blocks automated download. Owner to provide logo/photos in `brand/`. Meanwhile a 🌸 blossom mark + palette derived from the Instagram identity. |

**Still open**
- Team list (names, emails, roles, Telegram accounts) + the Telegram group. *(Reminder requested.)*
- Meaning of **"Ventes"** and **"Comptes"** in the admin menu. *(Discuss later, reminder requested.)*
- Policies: exchange/return rules, loyalty values, coupon ideas.
- Payments beyond COD (Chargily / BaridiMob): now or later?
- ZR Express API credentials (for parcel creation, tracking and price sync).

---

## 12. Progress

- [x] **Phase 0: Foundation** (verified 2026-09-30: typecheck ✓, 34 tests ✓, build ✓, local D1 migrated + seeded, `/`, `/ar`, `/admin`, `/api` smoke-tested) (monorepo, Bagisto removed, static export FR/AR, Worker + D1 schema + 69-wilaya/1,541-commune seed, admin shell with RBAC, CI)
- [x] **Phase 1: Storefront core** (2026-10-01): home with animated tagline, categories, product pages (variants, live stock, reviews, "Prévenez-moi"), cart, one-page checkout + commande express, thank-you, tracking (device / private link / phone), favourites, search, contact, link-in-bio, content pages, FR/AR. Verified end-to-end in a real browser.
- [x] **Phase 2: Admin core**: login (email + password + emailed code, invitations, reset, lockout), every menu section functional (see §5), Telegram bot (new-order messages with buttons, commands, retry outbox), demo seed.
- [ ] Phase 3: ZR Express API (parcel creation, labels, status sync): needs ZR API credentials.
- [ ] Not yet: loyalty points redemption at checkout, web push, Meta CAPI/pixels on the storefront, AVIF images, real email provider + Turnstile keys (deployment step).

**Architecture change vs. §2:** product/category/content pages are pre-built "_" shells that load their data from the API (edge-cached, versioned on every admin change), so admin edits and new products are live instantly with no rebuild. The Worker injects the product's title/OpenGraph tags for link previews.

**Resolved (2026-10-06, §15):** the storefront shipped ~173 KB gz of JS on the home page (Next 16 router runtime + React ≈ 135 KB before any of our code), against the 90 KB budget in §4.5. Now 42 KB.

---

## 13. Phase 4: growth & operations upgrade (2026-10-01)

### 13.1 Audit: what already existed

| Area | Already in place | Gap |
|---|---|---|
| COD verification | statuses `nouvelle → injoignable → confirmee → en_preparation → expediee → en_livraison → livree / retour / annulee / doublon / fausse`; zod validation on both sides; Turnstile; per-phone hourly limit; naive `risk_score` | risk score opaque (3 hard-coded terms), no reasons, not shown consistently |
| Checkout | wilaya → commune (loaded per wilaya, edge-cached) → domicile/bureau with prices; server-side quote | native `<select>` of 69/≈30 entries is slow on phones; no search; no commune-level pricing; delay not shown |
| Tracking | private link `code + token` (SHA-256 + pepper, timing-safe), phone lookup with limited data, timeline | no money breakdown, no commune, no unit prices, cancelled/returned shown as one line |
| Sharing / OG | Worker injects title/description/og:image (1440 px) into product shells | no share button; no og:url/site_name/price/twitter card; image larger than needed |
| Abandoned checkout | `carts` table + admin "Paniers", saved only with an opt-in checkbox, web checkout only | most checkouts never captured; no commune/delivery/step; express checkout ignored; recovery matched lazily by phone |
| Risk in admin | badges for returns / "Fidèle" / risk ≥ 50 | no 🟢🟡🔴 level, no explanation |
| Dashboard | KPIs, pipeline, recent orders, low stock, reviews/messages | no "needs attention" list (stale orders, high risk, abandoned, restock waitlists) |
| Order actions | one-tap status buttons, `tel:` and WhatsApp, notes, edit | no cancel/return reason, no tracking-number prompt on "Expédiée" |
| Performance | static shells, edge cache, responsive WebP + LQIP, lazy images | product page downloads the whole `/catalog` just for 4 related products |
| Related products | same category from the full catalogue (client side) | no "complete the look" logic |
| Badges | manual tags `nouveaute`, `best-seller` ("Coup de cœur") | nothing data-driven |
| New arrivals | home section sorted by `created_at` | no publication date, no dedicated page |
| Reviews | anyone can post (moderated), `verified` flag unused | not tied to delivered orders |
| Variants / stock | options × values → auto variants, per-variant stock, CHECK constraint prevents overselling | list only (no colour × size grid) |
| Stock alerts | `/stock` low/out filters, dashboard top-8 | no variant labels on dashboard, no waitlist link |
| Analytics | `/stats` (7–365 days, wilaya top-20, channels, hours, funnel) | no today/custom range, no reasons, no delivery durations, wilaya table incomplete |
| Segments | vip / fidèles / nouvelles / risque / inactives / blacklist | "risque" = any return; not aligned with the risk score |
| Product editor | duplicate, options presets, bulk stock | photos only after first save, no explicit draft/publish buttons |
| Drops | `collections` + `collection_products` tables (unused) | no dates, no page, no admin |
| Restock | "Prévenez-moi" → `stock_alerts`, admin Notifier waitlists | not surfaced when stock comes back |

### 13.2 Plan (smallest change that fits the existing architecture)

**Database: migration `0001_growth.sql`, additive only (`ALTER TABLE … ADD COLUMN`, `CREATE INDEX`)**
- `orders.risk_flags` (JSON reason codes captured at creation), `orders.outcome_reason`; index `orders(created_at)`, `orders(wilaya_code, created_at)`
- `customers.fake_count`
- `products.published_at`, `products.related_ids` (JSON); index `order_items(product_id)`
- `communes.home_price` (optional per-commune override)
- `carts.commune_id`, `carts.delivery_type`, `carts.channel`, `carts.locale`, `carts.subtotal`, `carts.shipping`
- `collections.description_fr/ar`, `starts_at`, `ends_at`, `show_countdown`, `lock_products`, `sort`, `created_at`
- `reviews` unique `(order_id, product_id)`

**Shared (`@henine/shared`)**: `risk.ts` (transparent weights → score, level 🟢🟡🔴, reasons; same weights produce the SQL used for the "high risk" segment), `insights.ts` (data-driven product badges with thresholds), `OUTCOME_REASONS`, DTO extensions.

**Features → files**
1. COD verification: `lib/orders.ts` computes risk flags at creation (history, same-IP burst, repeated orders, free-text commune, unusual basket); never blocks except the existing abuse rate limit.
2. Checkout: `CheckoutForm.tsx` gets a searchable bottom-sheet picker (wilaya by number/FR/AR name, communes of that wilaya only), delivery cards with price and delay, commune price override in `quote()`.
3. Tracking: `TrackedOrderDTO` + money breakdown, commune, unit prices; redesigned `/suivi` order card with a 6-step timeline and clear cancelled/returned states; review prompt for delivered items.
4. Sharing: Share button (Web Share API → fallback sheet: WhatsApp, Facebook, copy link) with `utm_source=share`; richer OG/Twitter tags (960 px image).
6. Abandoned checkout: autosave (debounced, after a valid phone) for web + express checkouts with a visible notice; `cartId` sent with the order marks the cart recovered; admin "Paniers" shows name, phone, items, total, wilaya/commune, step, last activity.
7. Risk: level + reasons in orders list, order sheet, customers, Telegram line.
8. Command center: `/dashboard` returns an `attention` list (to confirm, callbacks due, high risk, confirmed > 24 h, preparing > 48 h, shipped > 7 days, returns to check in, abandoned 24 h, restocked with waitlist, low/out of stock); `/orders?attention=…` filters.
9. Actions: reason picker on cancel / return / fake, tracking-number prompt on "Expédiée".
10. Performance: product detail returns `related` (no more full-catalogue download on product pages); audit bundle afterwards.
11. Complete the look: manual picks (`related_ids`) → bought together (co-occurrence in real orders) → same category best sellers.
13. Badges: best-seller / trending / popular from 30-day and 7-day sales of non-cancelled orders; manual "Coup de cœur" stays separate.
14. New arrivals: `published_at` set on first publication; `/nouveautes` page in AR + FR.
15. Verified reviews: only from a delivered order (private link token or phone + order code), one per product per order; auto-publish setting; admin hide/delete.
17. Variants: colour × size stock grid in the product editor; sold-out variants not addable (still selectable for "Prévenez-moi").
18. Stock alerts: dashboard stock section with variant labels and waitlists.
19–22. Analytics: today / 7 / 30 / 90 days / custom range; KPI set; full wilaya table; reasons breakdown; delivery durations (only with ≥ 5 samples).
23. Segments: new / returning / VIP / high-risk from history and the shared risk weights.
24. Product editor: "Enregistrer le brouillon" / "Publier", photos usable on a new product (auto-creates the draft), duplicate.
25. Drops: admin Marketing → Collections; public `/collection/<slug>` shell with OG tags and client countdown from server time; products of an unlaunched drop are hidden and unorderable when "lock" is on.
26. Restock: dashboard + Stock page show restocked variants with waiting customers; WhatsApp links per phone; Telegram notice to the team when a variant with a waitlist is restocked.

### 13.3 Result (2026-10-01)

Done and verified: typecheck ✓, 64 unit tests ✓ (new: risk score, segments, badges), build ✓, 23 storefront API checks, 40 admin API checks, phone-viewport browser runs of the storefront (AR + FR) and the admin, all green. Migration `0001_growth.sql` applied to the local D1 (backup taken first); it only adds columns/indexes and backfills `published_at` / `fake_count`.

Decisions taken while building (easy to revisit):
- **Abandoned checkouts** are now saved as soon as a valid phone number is typed (web + express checkouts), with a visible notice under the phone field; the old opt-in checkbox is gone. Saved checkouts are deleted after 30 days; nothing is ever sent automatically.
- **Statuses**: the existing ones cover the requested states (New = `nouvelle`, Pending verification = `injoignable`, …); no new status was added.
- **Risk score** = customer history + signals captured at checkout (`orders.risk_flags`). The "same connection" signal is deliberately weak (Algerian mobile networks share IPs). Never blocks an order.
- **Reviews**: only verified (delivered order, one per product per order, first name + initial), published automatically by default (switch in Admin → Avis). The old anonymous review form was removed; existing reviews are kept.
- **"Les plus demandées" / الأكثر طلبا** only appears when real sales back it; otherwise the section shows the team's "Coup de cœur" picks under that name.
- **Duplicate product** now shares the original's photos (R2 files are only deleted when no product uses them any more).
- **Drops**: the public cache key includes how many drop start/end times have passed, so a drop unlocks at the exact minute without a cron.

Performance: `@henine/shared` is marked `sideEffects: false`, so the storefront no longer ships Zod: **~240 KB → ~151 KB gz JS per page**. Product pages no longer download the whole catalogue (related products come with the product).

Known/open: ESLint 10 crashes with eslint-plugin-react (tooling, not run in CI). Commune-level delivery prices are supported by the API but have no admin editor yet (set `communes.home_price` / `home_supported`). Stop-desk addresses per wilaya still need ZR's list.

## 14. Order operations & catalogue (2026-10-05)

Built on what existed (tracking without login, customer cancel with reason, address self-edit,
risk score, call/WhatsApp buttons, product profit, daily Telegram summary are reused, not redone).

**Live admin** — `AdminHub` Durable Object (SQLite-backed, free plan, hibernating WebSockets) at
`/api/admin/live` (orders.view, same-origin). New storefront order → sound once per browser
(Web Locks), notification card, blinking tab, optional system notification, red counter on
Commandes (`team_members.orders_seen_at`). Sound / notification prefs per device
(Paramètres → Alertes & délais). Closed when an account is revoked.

**Alerts & SLA** — `alerts` table + topbar bell (unread / resolve). 5-minute scan in one D1 batch:
late orders against the SLA (`settings.operations.sla`: confirm 30 min, prepare 2 h, ship 24 h,
editable), unconfirmed backlog, parcels ready, critical stock. Receipt problems and exchange
requests alert instantly. "En retard" filter + dashboard line + badge on the order.

**Order sheet** — one action bar (call / WhatsApp / SMS / note, typed contact log as order
events), last contact, contacts across the customer's orders, previous orders, clear customer
warning, preferred contact time (checkout), receipt status. Edits before shipping only: items
(size / colour / qty / add / remove, reservations follow), customer fields; every change in
`order_changes` (old → new, who, when, why). Manual discount (fixed / %, reason, never negative,
`orders.discount`). Real profit per order (cost, delivery paid by the shop, packaging, discounts).

**Customer, private link** — "did you receive it?" (yes / problem) and exchange requests
(`exchange_requests`: pending → approved (piece set aside) → completed (stock swapped) / rejected).

**Daily report** — Statistiques → Rapport du jour (any day) + richer evening Telegram summary.

**Catalogue** — two-level tree (`categories.parent_id`, `season`): Pyjamas (été ☀️ / hiver ❄️, the
season's first; Paramètres → Boutique → Saison), Robes de chambre & nuisettes, Lingerie (Ensembles,
Soutiens-gorge & culottes, Gaines, Trousseau de mariée, Lingerie fine), Sportswear & survêtements,
Gandouras/djebbas/robes. Category pages: sub-category chips, price / promo / in-stock filters.
Nouveautés = latest arrivals (published or restocked). `/promotions` = everything on sale, biggest
discount first; admin "🏷️ Mettre en promo" (−X % on selected products, rounded to 50 DA, undo).

Migrations: `0003_operations`, `0004_category_season`.

## 15. Storefront engine: Next.js → Vite + Preact (2026-10-06)

**Why.** Performance audit: the home page shipped ~173 KB gzipped JS for a 90 KB budget (mid-range Android on 4G). The Next.js App Router runtime + React alone were ~135 KB before any store code, so the budget couldn't be met on Next. The store never used Next's router, links or images (every page change is a full page load; data comes from /api), only `next/font` and the page metadata.

**What changed.**
- `apps/web` builds with Vite; React's API runs on Preact (`react`/`react-dom` aliased to `preact/compat`). Components are unchanged.
- `src/pages.ts`: the route table (18 routes × AR/FR + 404). `scripts/build.mjs`: client build (one small entry per page and language, shared chunks), a build-time renderer (`src/server.tsx`, deleted after use), then every page pre-rendered to the same file layout as before (`out/index.html`, `out/fr/boutique.html`, `out/produit/_.html`…), linking only its own scripts and styles. The Worker's shell routing, link previews and `_headers`/CSP flow are unchanged (assets now under `/assets/*`, fonts under `/fonts/*`, both cached a year).
- Fonts: the same self-hosted subset files and metric-matched fallbacks, now plain CSS (`src/styles/fonts.css`, `public/fonts/`).
- New branded 404 pages (AR at `/404.html`, FR at `/fr/404.html`). Desktop header: the pill menu starts at 1280 px and shows icons from 1536 px, so the French labels never overlap.

**Result (gzip):** home 42.8 KB JS (was ~173), product page 65.7 KB, checkout 56.6 KB, every page < 66 KB; CSS 20.7 KB. Build ≈ 7 s. All 38 pages checked in a browser (render, hydration, no console errors); cart, quantity, checkout, menu and language switch verified.


## 16. Business operations (2026-10-06)

Audited first; reused what existed (order lifecycle, stock history, contact log, alerts + cron, audit log, analytics_daily, per-order profit). Migration `0005_business_operations`.
- **COD reconciliation** (Finance → Encaissements): per order expected / collected / courier fee / return fee / net / remitted / outstanding and status (pending, partial, reconciled, disputed, overpaid); courier payments split over orders (`cod_remittances`, `cod_allocations`), voidable; the courier's real fee (`order_finance`) replaces the wilaya-rate estimate in every profit view.
- **Physical stock count** (Stock → Inventaire): counting → submitted → approved/rejected; differences applied to today's stock through `stock_movements` (reason `inventaire`) only after approval (`stock.approve`).
- **Duplicate orders**: scored on creation (same phone/customer, address, items, amount, time), flagged with reasons, never auto-cancelled; keep / merge / cancel / reviewed / ignore; configurable in Paramètres → Alertes.
- **Order source attribution**: the store remembers the arrival (UTM, ad click ids, referrer, landing) 30 days and counts one visit per session; `orders.source` classified server-side; Statistiques → "D'où viennent les commandes" (orders, revenue, conversion, campaigns).
- **Failed deliveries** (Expéditions): follow-up queue (contact log in the order history, callbacks with alerts, assignment, escalation).
- **Courier manifests** (Expéditions → Bordereaux): draft → ready → handed over (orders become "expédiée", stock committed) → confirmed; tracking numbers in bulk, print, CSV. No multi-courier layer (ZR Express API still not connected).
- **Expenses + business P&L** (Finance): revenue → gross profit → order-level profit (same model as per-order profit) → operating expenses → net profit.
- Permissions `finance.view`, `finance.edit`, `stock.approve` (granted to the Gérante role by the migration).

## 17. Live site fixes (2026-10-06)

Live at https://henine-boutique.karimmaticmz.workers.dev (Worker `henine-boutique`, D1 `henine-boutique-db`).
- `PUBLIC_ORIGIN` was a placeholder → 500 on product pages, robots.txt, sitemap: set; the Worker now falls back to the request's own address if it is ever invalid.
- No secrets were set: generated `AUTH_PEPPER`, `IP_HASH_SALT`, `TRACK_TOKEN_PEPPER`, `SETTINGS_KEY`; Turnstile widget created on the account (site key in `TURNSTILE_SITE_KEY`, secret as `TURNSTILE_SECRET`).
- No email service → admin sign-in was impossible: accounts invited while email isn't configured use an authenticator app (TOTP, migration `0006_admin_authenticator`); with Resend/Brevo configured, emailed codes as before.
- Production had no `d1_migrations` table (schema loaded by hand): recorded 0000–0006 so `npm run migrate:remote` works from now on. Scripts use the `DB` binding instead of the old database name.

## 18. Real AI assistant + default order sound (2026-10-06)

- Assistant: rules (`assistant-intents.ts`) find the facts; `lib/assistant-ai.ts` has Gemma 4 (`@cf/google/gemma-4-26b-a4b-it`, Workers AI free allocation) word the answer in Arabic / Darija / French with the last 4 exchanges. Guards: amounts not in the facts → rules' answer; error, 9 s timeout, quota used up, `RL_AI` (10/min/IP) → rules alone. `ASSISTANT_MODEL=off` disables it. Verified live: ~1–2 s, stays on topic.
- Admin new-order sound: `apps/admin/public/sounds/annonce.mp3` is the built-in default (5 s, adjustable without uploading); an uploaded file still overrides it. The live shop's old uploaded sound (`sounds/order-mux1gzxk14xqcgq.mp3`, 3.5 s) was unset so the announcement plays; the R2 file is kept.
- Still needs the owner: set the password via the invitation link; Telegram bot token in Paramètres → Connexions; Resend/Brevo key for email; logo file; team list; ZR Express API credentials; one real test order; Google Search Console (submit /sitemap.xml); Instagram bio → /liens.
- 2026-10-07: assistant answers only shop questions (off-topic → one-line redirect, no products; rules return no products when nothing about clothes is asked); storefront "just ordered" popup and `/api/activity` removed (admins have live alerts); categories without piece counts; category page filters reduced to "Tout/Promos" toggle + price row.
