require('dotenv').config({ quiet: true });
const path = require('node:path');

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  ownerIds: (process.env.OWNER_IDS || '').split(',').filter(Boolean),

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || null,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || null,
  },

  deezer: {
    arl: process.env.DEEZER_ARL_COOKIE || null,
    decryptionKey: process.env.DEEZER_MASTER_KEY || null,
  },

  // Netscape-format cookies.txt from a (throwaway) YouTube account. Needed on server IPs that
  // YouTube flags as bots ("Sign in to confirm you're not a bot"). Unset -> ./cookies.txt if present.
  youtubeCookiesFile: path.resolve(process.cwd(), process.env.YOUTUBE_COOKIES_FILE || 'cookies.txt'),

  databaseFile: process.env.DATABASE_FILE
    ? path.resolve(process.cwd(), process.env.DATABASE_FILE)
    : path.resolve(process.cwd(), 'data', 'nexusbot.sqlite'),

  defaultVolume: Number(process.env.DEFAULT_VOLUME) || 80,

  // Watchdog interval (ms) that checks stalled voice connections
  watchdogIntervalMs: 30_000,

  // How often (ms) queue snapshots are allowed to be re-written per guild
  snapshotDebounceMs: 3_000,

  brand: {
    name: 'NexusBot',
    color: 0x8b5cf6,
  },
};
