const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { YoutubeExtractor } = require('discord-player-youtubei');

// Suppress noisy YouTube.js warnings
const _origWarn = console.warn;
const _origLog = console.log;
const SUPPRESSED = ['Unable to find matching run', 'Failed to extract signature', 'Failed to extract n decipher'];
function isSuppressed(...args) {
  const msg = args.map(String).join(' ');
  return SUPPRESSED.some(p => msg.includes(p));
}
console.warn = (...args) => { if (!isSuppressed(...args)) _origWarn.apply(console, args); };
console.log = (...args) => { if (!isSuppressed(...args)) _origLog.apply(console, args); };

const config = require('./config');
const logger = require('./utils/logger');
const { registerPlayerEvents } = require('./events/player');

// ---- Graceful shutdown ----
function shutdown(signal) {
  logger.info('Process', `Received ${signal}, shutting down gracefully...`);
  try { client.destroy(); } catch {}
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (!config.token || !config.clientId) {
  logger.error('Bootstrap', 'Missing DISCORD_TOKEN or CLIENT_ID in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // Message/Reaction/User partials let reaction roles work on panels posted before a restart
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

logger.setClient(client);

client.commands = new Collection();

// ---- Load slash commands ----
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command?.data?.name) {
    client.commands.set(command.data.name, command);
  }
}

// ---- Load discord.js client events ----
const discordEventsPath = path.join(__dirname, 'events', 'discord');
for (const file of fs.readdirSync(discordEventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(discordEventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// ---- Set up discord-player ----
const player = new Player(client, {
  skipFFmpeg: false,
});

// Without a listener, a failed extractor activation dumps the whole Player object to the console
player.extractors.on('error', (_context, extractor, err) => {
  logger.warn('Extractor', `${extractor?.constructor?.name ?? 'Extractor'} error`, { err: err?.message ?? String(err) });
});

// PLAYER_DEBUG=1 prints discord-player's full debug trace (stream extraction, fallbacks, voice) for diagnosing playback
if (process.env.PLAYER_DEBUG === '1') {
  player.on('debug', (message) => console.log('[debug:player]', message));
  player.events.on('debug', (queue, message) => console.log(`[debug:queue ${queue.guild.id}]`, message));
}

// discord-player-youtubei reports why each download method (peer/adaptive/sabr/yt-dlp) failed only
// through player debug messages: a "Stream extraction ... failed" line followed by the Error itself.
let logNextDebugError = false;
player.on('debug', (message) => {
  if (typeof message === 'string') {
    logNextDebugError = message.startsWith('[YouTube]: Stream extraction');
    if (logNextDebugError) {
      logger.warn('YouTube', message.replace('[YouTube]: ', '').replace(/ of \{[\s\S]*\} failed/, ' failed').slice(0, 300));
    }
    return;
  }
  if (logNextDebugError) {
    logger.warn('YouTube', 'Stream method error', { err: String(message?.message ?? message).slice(0, 500) });
    logNextDebugError = false;
  }
});

const YOUTUBE_RETRY_MS = 60_000;

// YouTube sometimes answers the startup player-script fetch with a 5xx. Retry a few times, then keep
// trying in the background: without YouTube, Spotify tracks bridge to SoundCloud and often play the wrong song.
// cookies.txt (Netscape format) -> "name=value; ..." header for youtubei.js
function readYoutubeCookieHeader(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#HttpOnly_/, '').split('\t'))
    .filter((parts) => parts.length >= 7 && !parts[0].startsWith('#') && parts[0].includes('youtube.com'))
    .map((parts) => `${parts[5]}=${parts[6]}`)
    .join('; ');
}

function youtubeOptions() {
  // "peer" needs self-hosted peers we don't have; skip it so failures don't waste a round trip
  const options = { downloads: { trialOrder: ['adaptive', 'sabr', 'yt-dlp'] } };
  if (!fs.existsSync(config.youtubeCookiesFile)) return options;
  try {
    const cookie = readYoutubeCookieHeader(config.youtubeCookiesFile);
    if (!cookie) throw new Error('no youtube.com cookies in file');
    options.cookie = cookie;
    options.downloads.ytdlp = { cookiePath: config.youtubeCookiesFile };
    logger.info('Bootstrap', 'Using YouTube cookies', { file: path.basename(config.youtubeCookiesFile), count: cookie.split('; ').length });
  } catch (err) {
    logger.warn('Bootstrap', 'Ignoring YouTube cookies file', { err: err.message });
  }
  return options;
}

async function tryRegisterYoutube() {
  const ext = await player.extractors.register(YoutubeExtractor, youtubeOptions()).catch(() => null);
  if (!ext) return false;
  // Every extractor defaults to priority 1, so Spotify tracks were bridged to SoundCloud first,
  // whose fuzzy match often picks a different song with the same name. Try YouTube first.
  ext.priority = 10;
  logger.info('Bootstrap', 'YouTube extractor registered');
  return true;
}

async function registerYoutube(attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    if (await tryRegisterYoutube()) return;
    if (i < attempts) await new Promise((r) => setTimeout(r, 5_000));
  }
  logger.warn('Bootstrap', `YouTube extractor failed to register, retrying every ${YOUTUBE_RETRY_MS / 1000}s`);
  let busy = false;
  const retry = setInterval(async () => {
    if (busy) return;
    busy = true;
    if (await tryRegisterYoutube()) clearInterval(retry);
    busy = false;
  }, YOUTUBE_RETRY_MS);
}

(async () => {
  await player.extractors.loadMulti(DefaultExtractors);

  const { SpotifyExtractor } = require('discord-player-spotify');
  if (config.spotify.clientId && config.spotify.clientSecret) {
    const spotifyExt = await player.extractors.register(SpotifyExtractor, {
      clientId: config.spotify.clientId,
      clientSecret: config.spotify.clientSecret,
    });
    if (spotifyExt) logger.info('Bootstrap', 'Spotify extractor registered (discord-player-spotify)');
    else logger.warn('Bootstrap', 'Spotify extractor failed to register');
  } else {
    logger.info('Bootstrap', 'Spotify skipped (no credentials)');
  }

  await registerYoutube();

  const { DeezerExtractor } = require('discord-player-deezer');
  if (config.deezer.arl && config.deezer.decryptionKey) {
    const deezerExt = await player.extractors.register(DeezerExtractor, {
      arl: config.deezer.arl,
      decryptionKey: config.deezer.decryptionKey,
    });
    if (deezerExt) logger.info('Bootstrap', 'Deezer extractor registered');
    else logger.warn('Bootstrap', 'Deezer extractor failed to register');
  } else {
    logger.info('Bootstrap', 'Deezer skipped (no ARL or decryption key)');
  }

  registerPlayerEvents(player);

  logger.info('Bootstrap', 'Extractors loaded', {
    extractors: [...player.extractors.store.keys()],
  });

  await client.login(config.token);
})().catch((err) => {
  logger.error('Bootstrap', 'Fatal startup error', { err: String(err) });
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.error('Process', 'Unhandled promise rejection', { err: String(err) });
});
process.on('uncaughtException', (err) => {
  logger.error('Process', 'Uncaught exception', { err: String(err) });
});
