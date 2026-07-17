# Changelog

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
