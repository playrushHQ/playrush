# Playrush

Playrush is a mobile-first **sports + gaming + social** starter based on the full product specification.

## Core game experience

Every game is designed around exactly three easy tabs:

1. **Main Feed** — score, status/clock, stats, leaders and key moments.
2. **Play-by-Play (All)** — every available recorded event: scores, fouls, rebounds, turnovers, substitutions, timeouts, etc.
3. **Live Chat** — game-specific community chat.

When a real game is active, the first two views should update from a reliable sports API and chat should update through the backend/WebSocket. This static starter intentionally does **not** invent scores, events or live status.

## Predictions and the Pistons/Bulls example

The requested example is represented as an **XP reward modifier**, not a wager:

- Pistons: 76% lower XP reward modifier.
- Bulls: 24% higher XP reward modifier.
- Users pick a team and earn XP when the prediction is correct.
- Valuable/transferable coins are **not wagered on real-world sports**.
- Prediction history, accuracy, streaks and leaderboards belong in the backend.

The starter currently calculates a simple local XP preview so the interaction works. A production backend should resolve the actual result and award XP server-side after the game finishes.

## Coins

Coins are an in-app progression/cosmetic currency:
- Balance
- Earn/spend
- Store
- Transaction history (backend)
- Cosmetics
- Badges
- Username styles
- Post boosts
- Exclusive reactions
- Digital items
- Weekly/monthly/seasonal competitions
- Coin leaderboard

The production backend should keep an immutable transaction ledger and calculate balances server-side.

## Social

Included UI/workflows:
- Main Feed
- Posts
- Likes
- Replies
- Follows
- Sharing
- Profiles
- Notifications (backend-ready)
- Search
- Trending
- Communities (backend-ready)

## Sports navigation

`Sports → League → Season → Date → Games → Game`

The starter includes NBA/NFL/MLB/NHL league entry points and a game-opening flow. Real league/season/date/game data is intentionally API-driven.

## Backend checklist

Connect:
- Accounts/login
- Database
- Posts/comments/likes/follows/shares
- Notifications
- Communities
- XP/rank/leaderboards
- Coin ledger/store
- Prediction settlement
- Reliable live + historical sports API
- Live Game Center event stream
- Real-time game chat

## GitHub Pages

Upload the files to a repository and enable GitHub Pages. The frontend works as a static prototype.

For production, connect the frontend to your backend and never expose private API keys in client-side JavaScript.

## Product rule

Every visible control must work or clearly communicate its state. No fake sports data.
