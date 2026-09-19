# Playrush

Playrush is a public, mobile-first **sports social network** built around a real Game Center.

The product is designed to feel like a sports app first and a social platform second: current games, full schedules, live event feeds, historical seasons, community posts, profiles and a digital store all live in one experience.

## What is in this release

### Game Center
- NBA, NFL, MLB and NHL schedule browsing
- Current season is the default:
  - NBA: 2026–27
  - NFL: 2026
  - MLB: 2026
  - NHL: 2026–27
- Historical seasons remain available, including 2016–17
- Regular season, postseason and preseason filters
- Date navigation and full-season schedule retrieval
- Real game IDs and team data from the sports provider
- Game pages with scoreboard, status, venue, broadcast, main event feed, play-by-play and box score data when supplied
- Live games automatically refresh

### Social
- Public community feed
- Persistent posts and likes when Postgres is configured
- Guest profile identity stored in a signed browser session
- Editable handle and email
- Profile wallet and digital unlocks

### Store + real payments
- Playrush Store page
- Rush Coin packs
- Digital profile/supporter unlocks
- Cosmetics can also be redeemed with Rush Coins after purchase
- Secure Stripe Checkout embedded in the site
- Stripe webhook fulfillment
- Idempotent order records
- Wallet crediting after successful payment
- Digital entitlement fulfillment
- Billing/receipts portal for Stripe customers

**Important:** real-money purchases are disabled until Stripe is configured. The app never pretends a payment happened. Do not ship live payments without completing Stripe's business, tax, refund, privacy and terms requirements.

## Run locally

Requires Node 20+.

```bash
npm install
npm start
```

Open `http://localhost:8787`.

Without `DATABASE_URL`, Playrush uses an in-memory development store. That is useful for local testing, but it is **not persistent** and should not be used as the production database.

## Production deployment

Use a Node host such as Render. GitHub is the source-code repository; GitHub Pages cannot run the Express backend that powers schedules, games, social persistence and payments.

The included `render.yaml` provisions:
- a Node web service
- a Postgres database
- generated `SESSION_SECRET`
- environment-variable slots for the public URL and Stripe keys

### Required production environment variables

```text
PUBLIC_URL=https://your-real-domain.example
SESSION_SECRET=<long-random-secret>
DATABASE_URL=<postgres-connection-string>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` **out of GitHub**. Only the publishable key belongs in browser-visible configuration, and this build retrieves it from `/api/config`.

## Stripe setup

Playrush uses Stripe Checkout rather than handling card numbers itself. Stripe's embedded Checkout flow requires the Checkout Session to be created server-side, with the client secret returned to the browser. urlStripe embedded Checkout guidehttps://docs.stripe.com/checkout/embedded/quickstart

1. Create a Stripe account and enable the payment methods you want.
2. Start with **test mode**.
3. Add `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` to the deployment environment.
4. Add a Stripe webhook endpoint:

```text
https://YOUR_DOMAIN/api/stripe/webhook
```

5. Subscribe it to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
6. Put the generated `whsec_...` signing secret into `STRIPE_WEBHOOK_SECRET`.

Stripe sends webhook events to a public HTTPS endpoint, and the signing secret is used to verify that the event came from Stripe. urlStripe webhooks guidehttps://docs.stripe.com/webhooks

The store's product catalog, prices and fulfillment rules are kept server-side so a browser cannot change the amount it is asking to buy. Stripe's Checkout documentation likewise recommends keeping product inventory and pricing on the server. citeturn2view0

### Test purchase

With Stripe test mode enabled, Stripe documents `4242 4242 4242 4242` as a successful test card. citeturn2view0

Do not use test keys or test cards in production.

## Sports data

The server calls the public ESPN site API for schedule and game information and caches responses. Playrush does not manufacture scores, teams or plays when a provider does not return them.

For a commercial public launch, review the sports-data provider's licensing, redistribution and rate-limit terms. If you move to a licensed provider, the frontend can stay largely unchanged because the server normalizes the data into Playrush's Game Center format.

## Security / production checklist

Before a real public launch:

- Use HTTPS.
- Set a strong `SESSION_SECRET`.
- Use Postgres, not the in-memory fallback.
- Configure Stripe webhooks and verify signatures.
- Configure Stripe tax, refunds, receipts and business settings as appropriate.
- Publish Terms of Service and Privacy Policy.
- Add moderation/reporting/rate limits for the public social feed.
- Add stronger account authentication before treating guest profiles as permanent accounts.
- Confirm the sports-data provider permits the intended commercial/public use.
- Add monitoring, backups and structured logs.

## GitHub

Commit the repository contents to the `main` branch. Do not commit `.env` files, secret keys, Stripe webhook secrets, or database credentials.
