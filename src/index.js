const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');

const config = require('./config');
const logger = require('./utils/logger');
const { registerPlayerEvents } = require('./events/player');

if (!config.token || !config.clientId) {
  logger.error('Bootstrap', 'Missing DISCORD_TOKEN or CLIENT_ID in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

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

(async () => {
  await player.extractors.loadMulti(DefaultExtractors);

  // Register Spotify credentials if provided, for better rate limits than
  // the default unauthenticated metadata bridge.
  if (config.spotify.clientId && config.spotify.clientSecret) {
    const spotifyExtractor = player.extractors.get('com.discord-player.spotifyextractor');
    spotifyExtractor?.setOptions?.({
      clientId: config.spotify.clientId,
      clientSecret: config.spotify.clientSecret,
    });
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
