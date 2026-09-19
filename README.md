# Playrush

Playrush is a mobile-first sports social network built around a real Game Center: live-ready schedules, historical seasons, game feeds, community, profiles, Rush Coins and a digital store.

## Included in this release

- NBA, NFL, MLB and NHL schedules with current-season defaults for 2026/27 or 2026
- Historical season browsing, including 2016–17 where the provider supplies data
- Game pages with scoreboard, main event feed, play-by-play and box score data when supplied
- Live refresh for active games
- Community feed with persistent Postgres storage
- Rush Coin wallet and transaction ledger
- Virtual-coin game wagers with automatic settlement from final game results
- Store with Stripe Checkout and verified webhook fulfillment
- Support tickets routed to `boxfights806@gmail.com`
- Email/password accounts
- Google OAuth sign-in
- Apple Sign in with Apple
- Secure signed sessions and production security headers

## Run locally

Requires Node 20+.

```bash
npm install
npm start
```

Open `http://localhost:8787`.

Without `DATABASE_URL`, Playrush uses an in-memory development store. That fallback is intentionally not persistent and should not be used for production.

## Production deployment

A Node host such as Render can run the Express backend and Postgres database. GitHub is the source repository; GitHub Pages cannot run the backend required by Game Center, accounts, social persistence and payments.

The included `render.yaml` provisions a Node web service, Postgres, a generated session secret, and environment-variable slots.

### Required production variables

```text
PUBLIC_URL=https://your-real-domain.example
SESSION_SECRET=<long-random-secret>
DATABASE_URL=<postgres-connection-string>
```

### Optional service variables

```text
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
SUPPORT_FROM_EMAIL=
```

### Authentication variables

Google:

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Google OAuth callback:

```text
https://YOUR_DOMAIN/api/auth/google/callback
```

Apple:

```text
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=
```

Apple callback:

```text
https://YOUR_DOMAIN/api/auth/apple/callback
```

For Apple, `APPLE_PRIVATE_KEY` should contain the contents of the `.p8` key. If stored as one line in a hosting dashboard, `\\n` sequences are converted back into newlines by Playrush.

**Never commit these values to GitHub.**

## Authentication behavior

The browser can discover which providers are configured through `/api/auth/providers`. Google and Apple buttons are hidden until their server-side credentials are present.

Email/password passwords are hashed with bcrypt. OAuth identity tokens are verified against the provider's signing keys before an account is created or linked. OAuth state and nonce values are signed and short-lived to prevent login-CSRF/replay attacks.

A provider login links to an existing Playrush account when the verified email matches an existing account. Apple may use Apple's private relay email address when the user chooses that option.

## Stripe

Playrush uses Stripe Checkout rather than handling card numbers directly. Keep secret Stripe keys server-side. The webhook endpoint is:

```text
https://YOUR_DOMAIN/api/stripe/webhook
```

Configure the webhook for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.

Real-money purchases are disabled until Stripe is configured. Do not treat browser success messages as payment confirmation; fulfillment is driven by verified webhook events.

## Sports data

The server currently normalizes the public ESPN site feed into Playrush's Game Center format and caches responses. Playrush does not fabricate games, scores or plays when a provider does not return them.

For a commercial public launch, review the provider's current licensing, redistribution and rate-limit terms. If a licensed provider is selected later, the frontend can continue consuming the normalized Playrush API.

## Rush Coins

Rush Coins are virtual Playrush currency. They have no cash value and cannot be withdrawn. Wagers use Coins only; there is no cash-out mechanism in Playrush.

The Postgres wallet uses a transactional ledger so balance changes can be audited. Wager settlement occurs only after the Game Center receives a final game state and a non-tied result.

Review applicable age, consumer, virtual-currency and wagering requirements before public launch in every jurisdiction where Playrush will be offered.

## Production checklist

- [ ] Use HTTPS and a real `PUBLIC_URL`
- [ ] Use Postgres, not the in-memory fallback
- [ ] Set a strong `SESSION_SECRET`
- [ ] Configure Google/Apple callback URLs exactly
- [ ] Configure Stripe webhooks and test fulfillment in test mode first
- [ ] Configure transactional email for support
- [ ] Publish Terms, Privacy and account deletion/contact policies
- [ ] Add moderation/reporting procedures for the public feed
- [ ] Confirm sports-data rights for the intended public/commercial use
- [ ] Add monitoring and database backups
- [ ] Review age/jurisdiction requirements for virtual-coin wagering

## GitHub

Commit source files to `main`. Never commit `.env`, database credentials, OAuth secrets, Apple `.p8` keys, Stripe secret keys, or webhook signing secrets.
