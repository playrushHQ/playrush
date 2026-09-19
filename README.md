# Playrush Elite

A sports-first Playrush rebuild centered on a real Game Center. The default experience is the **2016–17 NBA season**, with the season schedule, individual games, play-by-play, and traditional box scores loaded from the NBA Stats API through the included Node/Express backend.

## What works

- Real NBA schedule data — no placeholder Team A / Team B games.
- 2016–17 NBA Regular Season selected by default.
- Season, stage, and date filters.
- Previous/next-day navigation.
- Click any scheduled game to open its Game Center.
- Game Center scoreboard and game metadata.
- Full play-by-play event stream when the provider returns it.
- Traditional player box score when the provider returns it.
- Responsive mobile/desktop UI.
- Honest loading, empty, and API-error states.
- Same-origin `/api` routes so the frontend works locally without editing URLs.

The community feed, predictions, and chat UI are intentionally lightweight client-side features. They are not represented as a production social/prediction backend.

## Run locally

Requirements: **Node.js 20+** and internet access to the NBA Stats API.

```bash
npm install
npm start
```

Open:

`http://localhost:8787`

The server serves both the frontend and API, so you do **not** need a separate frontend server.

## Put it on GitHub

1. Create a new GitHub repository.
2. Copy/upload the contents of this folder into the repository.
3. Commit and push.
4. For a live deployment, use a Node-capable host such as Render, Railway, Fly.io, or another service that can run `npm start`.

### Important: GitHub Pages

GitHub Pages can host the static HTML/CSS/JS, but it cannot run the included Express server. Because the Game Center needs the server-side sports proxy, **GitHub Pages alone will not make the sports data work**.

This repository includes `render.yaml` so the same GitHub repository can be deployed as a Node web service on Render.

## Deploy from GitHub with Render

1. Push this repository to GitHub.
2. In Render, create a new Blueprint/Web Service from the GitHub repository.
3. Render will use `render.yaml` and run `npm start`.
4. Open the generated HTTPS URL.

No NBA API key is required by this project. The backend calls the public NBA Stats endpoints and keeps the request headers server-side.

## Project structure

```text
.
├── index.html
├── app.js
├── styles.css
├── config.js
├── config.example.js
├── server.js
├── package.json
├── render.yaml
├── .gitignore
└── .github/
    └── workflows/
        └── check.yml
```

## API routes

### Health

`GET /api/health`

### Schedule

`GET /api/schedule?sport=nba&season=2016-17&stage=Regular%20Season`

Optional date filter:

`GET /api/schedule?sport=nba&season=2016-17&stage=Regular%20Season&date=2017-04-12`

### Game

`GET /api/games/{NBA_GAME_ID}?sport=nba`

The game route combines game summary, play-by-play, and traditional box-score data.

## Sports coverage

NBA is the connected provider in this build. NFL, MLB, and NHL buttons remain visible in the product, but the backend deliberately returns a clear `501` response until a real provider is configured for those sports. **No fabricated schedules are shown.**

## Production notes

For a serious production launch, add:

- persistent caching/database storage,
- rate limiting,
- structured logs and monitoring,
- a dedicated real-time WebSocket service for live chat,
- authenticated accounts,
- server-side prediction settlement,
- provider-specific integrations for NFL/MLB/NHL,
- HTTPS and a production reverse proxy.
