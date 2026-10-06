# NexusBot

A free Discord music bot with 24/7 playback, gapless song transitions, YouTube
Music–style autoplay, multi-source playback (YouTube, Spotify, SoundCloud,
Deezer, Apple Music), custom playlists, reaction roles, queue persistence, and
reconnect recovery — built on `discord.js` v14 and `discord-player` v7.

## Features

- **Gapless playback** — the next song's stream is prepared ~30s before the
  current one ends, so songs follow each other with under 0.1s of silence
  (it used to be ~6s). Works for queued songs and autoplay.
- **Autoplay that keeps going** — when the queue runs out, the bot plays from
  YouTube Music's radio for the last song (similar artists, like YouTube Music's
  own autoplay). Works for Spotify and Deezer songs too, and never repeats a
  song from the session.
- **Many sources** — YouTube, Spotify, SoundCloud, Deezer, Apple Music, Vimeo
  and file links. `/play` suggests YouTube results as you type.
- **24/7 mode**, **filters** (bassboost, nightcore, 8D, lofi, …), **vote-skip**,
  **saved playlists**, and a live **now-playing panel** with buttons.
- **Survives restarts** — the queue, volume and loop mode come back after a
  crash or deploy.
- **Reaction roles** — Carl-bot / Dyno style panels with reactions, buttons or
  a dropdown (see below).

## Setup

### 1. Prerequisites
- Node.js 18.17+
- ffmpeg installed on the host (or use the provided Dockerfile, which installs it for you)
- A Discord application + bot token: https://discord.com/developers/applications
  - No privileged intents are required (the **Server Members Intent** is *not* needed).
  - Invite the bot with the link from `/info` (or the bot's About Me). It requests every permission the bot uses, including `Manage Roles`, `Add Reactions` and `Manage Messages` for reaction roles.

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

### Optional: Deezer support
Set `DEEZER_ARL_COOKIE` and `DEEZER_MASTER_KEY` in `.env` to enable Deezer
playback. Both values come from external sources (DMCA-sensitive, not included
in the package). Deezer supports both URLs and text search via its public API.

### YouTube on a VPS: cookies
YouTube blocks most cloud/VPS IPs ("Sign in to confirm you're not a bot"), so
songs show as "Now playing" but no audio plays. Export a `cookies.txt`
(Netscape format, e.g. with the "Get cookies.txt LOCALLY" browser extension)
from a **throwaway** YouTube account and put it in the project root. It's
picked up on start (`Using YouTube cookies` in the log) and is git-ignored.
Use `YOUTUBE_COOKIES_FILE` for another path; with Docker put it in `./data/`
and set `YOUTUBE_COOKIES_FILE=./data/cookies.txt`.

To check it from the server:
```bash
node_modules/youtube-dl-exec/bin/yt-dlp --cookies cookies.txt -f bestaudio -g "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```
A URL means it works; "Sign in to confirm you're not a bot" means the cookies
are missing, expired or flagged.

### Troubleshooting playback
Set `PLAYER_DEBUG=1` in `.env` to print discord-player's full trace (stream
lookups, fallbacks, voice). Warnings like `Stream extraction failed with the
method adaptive` or `Invalid Youtube Link.` are normal as long as the song
plays: the bot tries the next download method or source on its own. A real
failure also posts "⚠️ Couldn't stream …" in the channel.

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

- Every queue change (tracks, volume, loop mode, shuffle) schedules a debounced
  snapshot write to `data/nexusbot.sqlite` (guild, voice channel, track list,
  volume, repeat mode). A graceful shutdown (`pm2 restart`, Ctrl+C) writes any
  pending snapshot first.
- On boot, `queueManager.rehydrateAllQueues()` reads all snapshots and
  rejoins/re-queues so a full process restart (crash, deploy, OOM) picks up
  close to where it left off. The current song restarts from the beginning.
- A session that ended while the bot was running (`/stop`, End Session, the
  bot leaving an empty channel, or being disconnected) is forgotten, so a
  restart doesn't bring it back.
- A 30s watchdog checks every active voice connection's state and forces a
  rejoin if it's found dead without having emitted a clean `disconnect` event.
- In-session errors (a single track failing to stream) are caught by the
  `playerError` handler, which logs and lets discord-player auto-advance
  instead of killing the whole queue.

## Commands

| Command | What it does |
|---|---|
| `/play query` | Play or queue a song, playlist or link (suggestions as you type) |
| `/search query` | Pick one of the top 10 results |
| `/playnext query` | Put a song right after the current one |
| `/skip` | Skip (vote-skip when several people are listening) |
| `/pause`, `/resume`, `/stop` | Pause, resume, or stop and clear the queue |
| `/queue`, `/nowplaying` | Show the queue / the current song |
| `/remove position`, `/shuffle` | Edit the queue |
| `/seek time`, `/volume level`, `/filters filter` | Control the current song |
| `/loop mode` | Off, track, queue or autoplay |
| `/autoplay enabled` | Keep playing related music when the queue ends (saved per server) |
| `/247 enabled` | Stay in voice permanently (needs **Manage Server**) |
| `/playlist save\|load\|list\|delete` | Your saved playlists in this server |
| `/info` | Bot info and invite link |
| `/reactionrole create\|add\|remove\|mode\|list\|delete` | Reaction roles (needs **Manage Roles**) |

**Who can control the music:** commands and buttons that change playback
(`/stop`, `/skip`, `/volume`, `/loop`, `/seek`, the panel buttons, …) only work
for people in the bot's voice channel, and `/play` can't pull the bot into
another channel while people are listening. When nobody is listening (e.g. a
24/7 bot sitting alone), anyone can use them. Server admins can change who sees
each command in **Server Settings → Integrations**.

## Reaction roles

Carl-bot / Dyno style self-assignable roles. Requires **Manage Roles** to use
the command, and the bot's role must sit above every role it hands out.

1. `/reactionrole create` — posts a panel as a card with the server icon and a color
   accent taken from its roles. Pick a **style**:
   - `reaction` — members react with an emoji (max 20 roles)
   - `button` — one button per role (max 25; up to 11 sit next to their role, more become a grid)
   - `dropdown` — a select menu (max 25)
2. `/reactionrole add panel role emoji label description` — attach roles (emoji is required
   for reaction panels, optional otherwise). `description` is a one-liner shown under the
   role and in the dropdown.
3. `/reactionrole mode` — change behaviour at any time:

| Mode | Behaviour |
|------|-----------|
| `normal` | Pick to get the role, pick again / unreact to lose it |
| `unique` | Only one role from the panel at a time; picking a new one swaps |
| `verify` | Roles can only be added, never removed (rules acceptance) |
| `drop` | Picking removes the role |
| `reversed` | Reacting/choosing removes the role, unreacting/unchoosing gives it (buttons act like normal) |
| `binding` | The first pick is permanent |

`limit` caps how many roles a member can hold from one panel (0 = unlimited).
The panel's footer tells members how to pick and, for modes other than
`normal`, the rule that applies (e.g. "You can only have one of these roles.").
Members can add other emojis to a reaction panel; to prevent that, deny
**Add Reactions** for `@everyone` in that channel (the bot's own reactions
stay usable).
Panels keep working after restarts; deleting the panel message or a role
cleans up automatically. Panels made with the older embed layout switch to the
card the next time they're edited (add/remove/mode, or a dropdown pick).

## Project layout

```
src/
├── index.js                # bootstrap: client, Player, extractors, loaders
├── config.js               # env vars → config object
├── deploy-commands.js      # registers slash commands with Discord
├── commands/                # one file per slash command
├── events/
│   ├── discord/             # ready, interactionCreate, reaction/message/role events
│   └── player/              # discord-player lifecycle (now playing, errors, autoplay hook)
├── structures/
│   └── queueManager.js      # snapshotting, rehydration, watchdog
├── database/
│   └── db.js                # SQLite (better-sqlite3) schema + repositories
└── utils/
    ├── autoplay.js          # picks the next autoplay song (YouTube Music radio, fallbacks)
    ├── prefetch.js          # gapless playback: prepares the next song's stream early
    ├── playback.js          # shared player.play() options + guild autoplay
    ├── voice.js             # who may control the music
    ├── embeds.js
    ├── buttons.js
    ├── logger.js
    ├── invite.js            # invite link + required permissions
    ├── nowPlayingManager.js # track/cleanup/refresh now-playing messages
    ├── queryResolver.js     # query detection + extractor matching
    ├── reactionRoles.js     # panel rendering, emoji parsing, mode rules
    └── reactionRoleEvents.js # reaction / button / dropdown handlers
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
  Keep `discord-player-youtubei`, `youtubei.js` and `discord-player` up to date
  and watch their GitHub/Discord for extractor patches. YouTube also blocks
  most VPS IPs; see the cookies section above.
- **No bot streams real Spotify audio** (no ToS-compliant API for that).
  Spotify links are resolved to track metadata and bridged to a playable
  source (YouTube/SoundCloud) — this is standard even among paid competitors.
- **Deezer priority is low by default** — text queries go to YouTube/Spotify
  first. Set `deezerExt.priority = 12` after registration to make Deezer
  the preferred source.
