const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const config = require('./config');
const logger = require('./utils/logger');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command?.data) commands.push(command.data.toJSON());
}

const rest = new REST().setToken(config.token);

(async () => {
  try {
    const route = config.guildId
      ? Routes.applicationGuildCommands(config.clientId, config.guildId)
      : Routes.applicationCommands(config.clientId);

    logger.info('Deploy', `Registering ${commands.length} commands`, {
      scope: config.guildId ? `guild:${config.guildId}` : 'global',
    });

    await rest.put(route, { body: commands });
    logger.info('Deploy', 'Commands registered successfully.');
  } catch (err) {
    logger.error('Deploy', 'Failed to register commands', { err: String(err) });
    process.exit(1);
  }
})();
