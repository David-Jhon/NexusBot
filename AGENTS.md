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
- **Database:** `better-sqlite3` (synchronous, WAL mode). Tables: `guild_settings`, `queue_snapshots`, `saved_playlists`, `reaction_role_panels`, `reaction_roles`.
- **Reaction roles:** `/reactionrole` + `src/utils/reactionRoles.js` (all mode/limit rules live in `applyRoleAction`) + `src/utils/reactionRoleEvents.js`. Needs `GuildMessageReactions` intent and `Message`/`Reaction`/`User` partials so old panels work after restarts. Members are fetched with `force: true` because there's no `GuildMembers` intent.
- **Reaction-role panels are Components V2 cards** (`buildPanelMessage`). Always edit a panel with the full payload: it sets `content: null, embeds: []` so panels posted with the old embed layout upgrade instead of being rejected, and `allowedMentions: { parse: [] }` so role mentions don't ping. Limits: 40 components and 4000 text chars per message. Button panels show an inline button per role up to 11 roles, then fall back to a 5×5 button grid inside the card.
- **Persistence:** Queue state snapshotted to SQLite (debounced 3s). Rehydrated on boot. Watchdog checks every 30s for dead voice connections.
- **Vote-skip:** Uses a `__voteSkips` Set on the queue object (non-standard). Default threshold 0.5.

## Extractors

Registered in `src/index.js` bootstrap (order matters for priority):
1. `DefaultExtractors` — SoundCloud, Attachment, Vimeo, ReverbNation, Apple Music, built-in Spotify
2. `SpotifyExtractor` (from `discord-player-spotify`) — requires `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`
3. `YoutubeExtractor` (from `discord-player-youtubei` v3) — No credentials needed. **Priority set to 10** so Spotify tracks bridge to YouTube; at the default priority 1, SoundCloud (registered earlier) wins ties and often matches a different song with the same name.
4. `DeezerExtractor` — requires `DEEZER_ARL_COOKIE` + `DEEZER_MASTER_KEY`. **Supports text search** via Deezer's public API (`api.deezer.com/search/track`).

**Deezer priority:** Default priority is lower than YouTube/Spotify. To make Deezer the preferred source (like WD-40 does), set `deezerExt.priority = 12` after registration. Without this, text queries will go to YouTube/Spotify instead.

## Autoplay

Implemented in `src/events/player/index.js` (`willAutoPlay` event):
- Searches by **artist only** (not artist + title) for variety
- Filters out: subtitle/reaction videos, covers, remixes, compilations, BGM, similar titles (>60% word overlap)
- Checks track is actually by the same artist (title/author contains artist name)
- Fallback chain: YouTube → Spotify → Deezer (each forced to its own extractor)

## Production

- Docker: `docker compose up -d --build` (uses system ffmpeg, not npm's `ffmpeg-static`).
- PM2: `pm2 start ecosystem.config.js` (autorestart, 3s delay, max 20 restarts).
- SQLite at `./data/nexusbot.sqlite` — persists across restarts.

## Conventions

- CommonJS, no TypeScript, no linting, no tests, no CI.
- All dependencies are runtime deps (zero devDependencies).
- Commands use `useQueue(guildId)` / `useMainPlayer()` from discord-player (no DI).
- Anything that calls `player.play()` must pass `buildPlayOptions()` from `src/utils/playback.js`: nodeOptions (24/7, volume, self-deaf) only apply to the call that creates the queue, and it forces the YouTube/Deezer extractor for their links. Follow with `applyGuildAutoplay(queue)`.
- Commands that restart the stream (`/seek`, `/filters`) must `deferReply()` first; the restart can exceed Discord's 3s limit.
- Vote-skip logic lives in `voteSkip()` in `src/commands/skip.js`, shared with the Skip button. Votes reset on `playerStart`.
- Filters: `queue.filters.ffmpeg.toggle()` with 11 curated presets.
- Button interactions prefixed `nexus:`. The music handler in `interactionCreate.js` only claims IDs listed in `MUSIC_BUTTONS`; reaction-role components use `nexus:rr:`. Add new now-playing buttons to `MUSIC_BUTTONS`.

## Gotchas

- **YouTube.js parser warnings are harmless** — `ListItemView`, `ContinuationItemView`, signature decipher errors. They appear because YouTube changes their UI and the library catches up. The logger suppresses the noisy ones; some still leak through `console.warn`.
- **`discord-player-youtubei` v3 has undeclared deps** — it `require`s `simple-ytdl-core` (and peer `bgutils-js`) without listing them; both are in our `package.json`. Don't remove them. It now shares the root `youtubei.js` (deduped).
- **Deezer extractor steals YouTube URLs** — must force `searchEngine` option with `YoutubeExtractor` identifier to prevent attachmentextractor or deezer from handling YouTube URLs.
- **`queue.client` is undefined in `willAutoPlay`** — can't use `queue.client.user` for `requestedBy`. Use `queue.metadata.lastTrack` instead.
- **`youtube-dl-exec` requires Python** — install with `YOUTUBE_DL_SKIP_PYTHON_CHECK=1` if Python isn't available.
