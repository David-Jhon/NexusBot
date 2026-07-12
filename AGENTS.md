# NexusBot

A free, 24/7, feature-rich Discord music bot.

## Setup

```bash
npm install
cp .env.example .env   # then fill in DISCORD_TOKEN and CLIENT_ID
npm run deploy          # register slash commands
npm start               # start the bot
```

## Commands

| Script | Purpose |
|--------|---------|
| `npm start` | Production start (`node src/index.js`) |
| `npm run dev` | Dev mode with `--watch` (Node >=18) |
| `npm run deploy` | Register slash commands with Discord |

`GUILD_ID` in `.env` enables instant guild command sync; omit for global sync (up to 1h propagation).

## Architecture

- **Entrypoint:** `src/index.js` — boots Client, Player, extractors, loaders.
- **Commands:** `src/commands/*.js`, each exports `{ data, execute }`. Auto-discovered.
- **Events:** `src/events/discord/` and `src/events/player/` — auto-discovered.
- **Database:** `better-sqlite3` (synchronous, WAL mode). Tables: `guild_settings`, `queue_snapshots`, `saved_playlists`.
- **Persistence:** Queue state snapshotted to SQLite (debounced 3s). Rehydrated on boot. Watchdog checks every 30s for dead voice connections.
- **Vote-skip:** Uses a `__voteSkips` Set on the queue object (non-standard). Default threshold 0.5.

## Production

- Docker: `docker compose up -d --build` (uses system ffmpeg, not npm's `ffmpeg-static`).
- PM2: `pm2 start ecosystem.config.js` (autorestart, 3s delay, max 20 restarts).
- SQLite at `./data/nexusbot.sqlite` — persists across restarts.

## Conventions

- CommonJS, no TypeScript, no linting, no tests, no CI.
- All dependencies are runtime deps (zero devDependencies).
- Commands use `useQueue(guildId)` / `useMainPlayer()` from discord-player (no DI).
- Filters: `queue.filters.ffmpeg.toggle()` with 11 curated presets.
- Button interactions prefixed `nexus:`.
