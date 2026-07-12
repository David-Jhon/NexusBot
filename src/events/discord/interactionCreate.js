const { useQueue } = require('discord-player');
const logger = require('../../utils/logger');
const { errorEmbed } = require('../../utils/embeds');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (err) {
        logger.error('Command', `Error executing /${interaction.commandName}`, { err: String(err) });
        const payload = { embeds: [errorEmbed('Something went wrong running that command.')], ephemeral: true };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload).catch(() => null);
        } else {
          await interaction.reply(payload).catch(() => null);
        }
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('nexus:')) {
      const queue = useQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
      }

      const action = interaction.customId.split(':')[1];

      try {
        switch (action) {
          case 'pauseresume':
            queue.node.setPaused(!queue.node.isPaused());
            break;
          case 'skip':
            queue.node.skip();
            break;
          case 'stop':
            queue.delete();
            break;
          case 'shuffle':
            queue.tracks.shuffle();
            break;
          case 'loop':
            queue.setRepeatMode(queue.repeatMode === 0 ? 1 : 0); // toggle track loop
            break;
        }
        await interaction.deferUpdate();
      } catch (err) {
        logger.error('Button', 'Failed to handle now-playing button', { err: String(err) });
        await interaction.reply({ embeds: [errorEmbed('Could not perform that action.')], ephemeral: true }).catch(() => null);
      }
    }
  },
};
