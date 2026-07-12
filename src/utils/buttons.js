const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function nowPlayingButtons(queue) {
  const isPaused = queue.node.isPaused();

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('nexus:pauseresume')
      .setEmoji(isPaused ? '▶️' : '⏸️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nexus:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nexus:stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('nexus:shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nexus:loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
  );
}

module.exports = { nowPlayingButtons };
