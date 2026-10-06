const { MessageFlags } = require('discord.js');
const { useQueue, QueueRepeatMode } = require('discord-player');
const logger = require('../../utils/logger');
const { nowPlayingEmbed, errorEmbed, successEmbed } = require('../../utils/embeds');
const { nowPlayingButtons } = require('../../utils/buttons');
const { getNpMessage, clearNpMessage } = require('../../utils/nowPlayingManager');
const db = require('../../database/db');
const { isReactionRoleComponent, handleComponent } = require('../../utils/reactionRoleEvents');
const queueManager = require('../../structures/queueManager');
const { voteSkip } = require('../../commands/skip');

// Now-playing panel buttons (see utils/buttons.js)
const MUSIC_BUTTONS = new Set(
  ['pauseresume', 'skip', 'endsession', 'shuffle', 'loop', 'autoplay'].map((action) => `nexus:${action}`),
);

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;

      try {
        await command.autocomplete(interaction);
      } catch (err) {
        logger.error('Command', `Error in /${interaction.commandName} autocomplete`, { err: String(err) });
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (err) {
        logger.error('Command', `Error executing /${interaction.commandName}`, { err: String(err) });
        const payload = { embeds: [errorEmbed('Something went wrong running that command.')], flags: MessageFlags.Ephemeral };
        if (interaction.deferred && !interaction.replied) {
          // Replace the "thinking..." placeholder instead of leaving it stuck
          await interaction.editReply({ embeds: payload.embeds }).catch(() => null);
        } else if (interaction.replied) {
          await interaction.followUp(payload).catch(() => null);
        } else {
          await interaction.reply(payload).catch(() => null);
        }
      }
      return;
    }

    if (isReactionRoleComponent(interaction)) {
      try {
        await handleComponent(interaction);
      } catch (err) {
        logger.error('ReactionRoles', 'Failed to handle reaction role component', { err: String(err) });
      }
      return;
    }

    if (interaction.isButton() && MUSIC_BUTTONS.has(interaction.customId)) {
      const queue = useQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
      }

      // Only people listening with the bot can control it
      if (interaction.member?.voice?.channelId !== queue.channel?.id) {
        return interaction.reply({
          embeds: [errorEmbed('Join my voice channel to use these buttons.')],
          ephemeral: true,
        });
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
          case 'skip': {
            if (!queue.currentTrack) {
              await interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
              break;
            }
            // Same vote rules as /skip
            const result = voteSkip(queue, interaction.member);
            if (result.skipped) {
              await interaction.deferUpdate();
            } else if (result.error) {
              await interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
            } else {
              await interaction.reply({ embeds: [successEmbed(result.text)] });
            }
            break;
          }
          case 'endsession':
            await interaction.deferUpdate();
            clearNpMessage(queue);
            queue.delete();
            // Otherwise the saved snapshot brings the ended session back on the next restart
            queueManager.clearSnapshot(interaction.guildId);
            break;
          case 'shuffle':
            queue.tracks.shuffle();
            queueManager.scheduleSnapshot(interaction.guildId);
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
            queueManager.scheduleSnapshot(interaction.guildId);
            await interaction.deferUpdate();
            break;
          case 'autoplay': {
            const isAutoplay = queue.repeatMode !== QueueRepeatMode.AUTOPLAY;
            queue.setRepeatMode(isAutoplay ? QueueRepeatMode.AUTOPLAY : QueueRepeatMode.OFF);
            db.updateGuildSettings(interaction.guildId, { autoplay: isAutoplay });
            queueManager.scheduleSnapshot(interaction.guildId);
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
