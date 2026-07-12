require('dotenv').config();
const path = require('node:path');

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || null,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || null,
  },

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
