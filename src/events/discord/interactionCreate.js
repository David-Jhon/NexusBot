const { useQueue, QueueRepeatMode } = require('discord-player');
const logger = require('../../utils/logger');
const { nowPlayingEmbed, errorEmbed } = require('../../utils/embeds');
const { nowPlayingButtons } = require('../../utils/buttons');
const { getNpMessage, clearNpMessage } = require('../../utils/nowPlayingManager');
const db = require('../../database/db');

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
          case 'pauseresume': {
            queue.node.setPaused(!queue.node.isPaused());
            await interaction.deferUpdate();
            const msg = getNpMessage(queue);
            if (msg && queue.currentTrack) {
              await msg.edit({
                embeds: [nowPlayingEmbed(queue.currentTrack, queue)],
                components: nowPlayingButtons(queue),
              }).catch(() => null);
            }
            break;
          }
          case 'skip':
            queue.node.skip();
            await interaction.deferUpdate();
            break;
          case 'endsession':
            await interaction.deferUpdate();
            clearNpMessage(queue);
            queue.delete();
            break;
          case 'shuffle':
            queue.tracks.shuffle();
            await interaction.deferUpdate();
            break;
          case 'loop':
            queue.setRepeatMode(
              queue.repeatMode === QueueRepeatMode.OFF
                ? QueueRepeatMode.TRACK
                : queue.repeatMode === QueueRepeatMode.TRACK
                  ? QueueRepeatMode.QUEUE
                  : QueueRepeatMode.OFF,
            );
            await interaction.deferUpdate();
            break;
          case 'autoplay': {
            const isAutoplay = queue.repeatMode !== QueueRepeatMode.AUTOPLAY;
            queue.setRepeatMode(isAutoplay ? QueueRepeatMode.AUTOPLAY : QueueRepeatMode.OFF);
            db.updateGuildSettings(interaction.guildId, { autoplay: isAutoplay });
            await interaction.deferUpdate();
            break;
          }
        }
      } catch (err) {
        logger.error('Button', 'Failed to handle now-playing button', { err: String(err) });
        await interaction.reply({ embeds: [errorEmbed('Could not perform that action.')], ephemeral: true }).catch(() => null);
      }
    }
  },
};
