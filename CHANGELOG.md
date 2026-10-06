# Changelog

## Unreleased

### Added
- **Gapless song transitions** — the next song's stream is looked up ~30s before the current one ends (`src/utils/prefetch.js`), cutting the silence between songs from ~6.6s to under 0.1s
- **Gapless autoplay** — the next autoplay song is picked ~30s early and prefetched, so autoplay has no gap either
- **YouTube Music radio for autoplay** — related songs come from YouTube Music's "up next" (similar artists, like YouTube Music's own autoplay); works for Spotify/Deezer songs too
- **Reaction roles** (`/reactionrole`) — reaction, button and dropdown panels with Carl-bot modes (normal, unique, verify, drop, reversed, binding), a per-panel limit and optional per-role descriptions. Panels are Components V2 cards and keep working after restarts
- **YouTube cookies** — `cookies.txt` (or `YOUTUBE_COOKIES_FILE`) is passed to youtubei.js and yt-dlp, for VPS IPs that YouTube blocks with "Sign in to confirm you're not a bot"
- **`/play` autocomplete** — YouTube search suggestions
- **Invite link** with the required permissions, shown in `/info` and synced to the bot's About Me
- **`PLAYER_DEBUG=1`** — prints discord-player's full playback trace
- **Stream failure reporting** — YouTube download-method failures are logged, and the channel is told when a song can't be streamed or ends with no audio

### Changed
- Upgraded better-sqlite3 13, dotenv 18, youtubei.js 18, youtube-dl-exec and discord-player-youtubei 3
- YouTube extractor priority raised to 10 so Spotify tracks bridge to YouTube instead of a wrong SoundCloud match
- YouTube extractor registration retries 3 times, then every 60s in the background
- Shared playback helper (`buildPlayOptions`) used by `/search`, `/playnext`, `/playlist load` and queue restore
- Skip button uses the same vote rules as `/skip`; votes reset per track
- Now-playing buttons require being in the bot's voice channel
- Reaction-role panel footer shows how to pick plus a plain rule for non-obvious modes and limits; the mode badge and role count are gone

### Fixed
- `/reactionrole` "Unknown interaction" on slow hosts (replies are deferred)
- Command errors no longer leave a stuck "thinking…" reply
- `/filters` invalid presets; `/seek` input validation and timeouts
- `/search` picks consumed by other users' clicks
- `/playnext` not starting an idle 24/7 queue
- End Session coming back after a restart
- Autoplay fallback running with no title or artist
- Anyone in the server could `/stop`, `/volume`, `/seek`, `/remove`, etc. without being in the voice channel (the buttons already required it); control commands now need the bot's channel, and `/play` can't pull the bot away from people listening elsewhere
- Any member could toggle server-wide 24/7 mode; `/247` now needs Manage Server by default
- After the bot left an empty channel or was disconnected, a restart rejoined that channel and replayed the old queue
- Volume, loop mode and shuffle weren't saved, so a restart reverted them; changes in the last 3s before a restart were lost
- Autoplay stopping after a few songs: YouTube's related tracks always came back empty, and the artist search ran out of songs that passed its filters

## v1.1.0 — Multi-Source Extractors & Autoplay Improvements

### Added
- **Deezer support** via `discord-player-deezer` (optional, requires `DEEZER_ARL_COOKIE` + `DEEZER_MASTER_KEY`)
- **Spotify extractor** via `discord-player-spotify` (better `getRelatedTracks()` for autoplay)
- **Query resolver** utility (`src/utils/queryResolver.js`) for query type detection and extractor matching
- **Deezer URL unshortening** — resolves `link.deezer.com/s/...` short links to full URLs
- **Forced Deezer extractor** — prevents `attachmentextractor` from stealing Deezer URLs
- **Autoplay fallback search** — searches by artist name when extractor returns 0 related tracks
  - Forces `YouTubeiExtractor` to avoid Deezer bridging errors
  - Falls back to Spotify search if YouTube fails
- **Title similarity filter** — skips tracks with >60% word overlap (catches different versions of same song)
- **Artist name check** — rejects tracks not actually by the same artist
- **Expanded subtitle filter** — catches compilations, BGM, greatest hits, top lists, mixes, medleys
- **Targeted error messages** — extraction failed, private video, age-restricted, no results
- **Now playing vs Queued verb** — shows "Now playing" for first track, "Queued" for subsequent
- **YouTube.js warning suppression** — filters noisy `ListItemView`, `ContinuationItemView`, signature decipher warnings
- **Logger suppression** — same patterns filtered from custom logger
- **`googlevideo` dependency** — SABR stream support for YouTube
- **`youtube-dl-exec` dependency** — yt-dlp integration (requires Python)
- **Documentation** — updated AGENTS.md, README.md, architecture.md, memory.md

### Changed
- **YoutubeiExtractor** — switched from `WEB` client to `ANDROID` (better anonymous access)
- **Spotify extractor** — replaced built-in with `discord-player-spotify` package
- **Autoplay search query** — changed from `artist + title` to `artist + "music"` for variety
- **Play command** — uses query resolver for better extraction and error handling
- **Extractor registration** — reordered for correct priority (DefaultExtractors → Spotify → YouTube → Deezer)

### Fixed
- **Deezer extractor stealing YouTube URLs** — now forces `YouTubeiExtractor` for YouTube search
- **Autoplay playing same song repeatedly** — title similarity filter prevents different versions
- **Autoplay picking unrelated tracks** — artist name check ensures tracks are by the same artist
- **Autoplay picking compilations/BGM** — expanded filter catches these patterns
- **Deezer short links failing** — now unshortens `link.deezer.com/s/...` URLs
- **Generic error messages** — now shows specific messages for common failure cases
