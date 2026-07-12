# NexusBot

A free Discord music bot with 24/7 playback, autoplay, Spotify/YouTube/SoundCloud
support, custom playlists, queue persistence, and reconnect recovery —
built on `discord.js` v14 and `discord-player` v7.

## Setup

### 1. Prerequisites
- Node.js 18.17+
- ffmpeg installed on the host (or use the provided Dockerfile, which installs it for you)
- A Discord application + bot token: https://discord.com/developers/applications
  - Enable the **Server Members Intent** is *not* required. Only **Guild Voice States** is needed, which is not privileged.
  - Invite the bot with the `bot` and `applications.commands` scopes and at least: `View Channel`, `Connect`, `Speak`, `Send Messages`, `Embed Links`.

### 2. Install
```bash
npm install
cp .env.example .env
# edit .env: DISCORD_TOKEN, CLIENT_ID, optionally GUILD_ID for instant dev command sync
```

### 3. Register slash commands
```bash
npm run deploy
```
Run this again any time you add/change a command's definition.

### 4. Run
```bash
npm start
```

### Optional: Spotify credentials
Register a free app at https://developer.spotify.com/dashboard and set
`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in `.env` for higher rate limits
than the default unauthenticated Spotify→YouTube bridge.

## Running in production

### Option A — Docker
```bash
docker compose up -d --build
```
`restart: always` in `docker-compose.yml` handles crash recovery at the
container level. Data (SQLite DB) persists in `./data`, which is bind-mounted.

### Option B — pm2
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed instructions to survive host reboots
```

## How persistence + recovery work

- Every queue mutation schedules a debounced snapshot write to
  `data/nexusbot.sqlite` (guild, voice channel, track list, volume, repeat mode).
- On boot, `queueManager.rehydrateAllQueues()` reads all snapshots and
  rejoins/re-queues so a full process restart (crash, deploy, OOM) picks up
  close to where it left off.
- A 30s watchdog checks every active voice connection's state and forces a
  rejoin if it's found dead without having emitted a clean `disconnect` event.
- In-session errors (a single track failing to stream) are caught by the
  `playerError` handler, which logs and lets discord-player auto-advance
  instead of killing the whole queue.

## Command list (v1)

`/play`, `/search`, `/skip`, `/stop`, `/pause`, `/resume`, `/queue`,
`/nowplaying`, `/loop`, `/volume`, `/shuffle`, `/playnext`, `/remove`,
`/seek`, `/filters`, `/247`, `/autoplay`, `/playlist save|load|list|delete`

## Project layout

```
src/
├── index.js                # bootstrap: client, Player, extractors, loaders
├── deploy-commands.js      # registers slash commands with Discord
├── commands/                # one file per slash command
├── events/
│   ├── discord/             # ready, interactionCreate
│   └── player/               # discord-player lifecycle + error handling
├── structures/
│   └── queueManager.js      # snapshotting, rehydration, watchdog
├── database/
│   └── db.js                 # SQLite (better-sqlite3) schema + repositories
├── utils/
│   ├── embeds.js
│   ├── buttons.js
│   └── logger.js
└── config.js
```

## Notes on scaling

This setup (single process, SQLite) comfortably handles low/mid hundreds of
guilds — voice connections and bandwidth are the real ceiling, not CPU. If
you outgrow that:
1. Move to `ShardingManager` once you approach ~2,500 guilds.
2. Swap SQLite for Postgres and add Redis if you need multiple processes/
   machines to share guild ownership. Not needed until you're actually there
   — don't pre-build it.

## Known limitations to plan around

- **YouTube extraction breaks periodically** as YouTube changes its internals.
  Keep `@discord-player/extractor` and `discord-player` up to date and watch
  their GitHub/Discord for extractor patches.
- **No bot streams real Spotify audio** (no ToS-compliant API for that).
  Spotify links are resolved to track metadata and bridged to a playable
  source (YouTube/SoundCloud) — this is standard even among paid competitors.
