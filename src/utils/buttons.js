const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function nowPlayingButtons(queue) {
  const isPaused = queue.node.isPaused();
  const loopMode = queue.repeatMode;
  const isAutoplay = loopMode === 3; // QueueRepeatMode.AUTOPLAY

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('nexus:pauseresume')
      .setEmoji(isPaused ? '▶️' : '⏸️')
      .setLabel(isPaused ? 'Resume' : 'Pause')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nexus:skip')
      .setEmoji('⏭️')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('nexus:loop')
      .setEmoji('🔁')
      .setLabel('Loop')
      .setStyle(loopMode > 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nexus:shuffle')
      .setEmoji('🔀')
      .setLabel('Smart Shuffle')
      .setStyle(ButtonStyle.Success),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('nexus:autoplay')
      .setEmoji('♾️')
      .setLabel('Autoplay')
      .setStyle(isAutoplay ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('nexus:endsession')
      .setEmoji('⏹️')
      .setLabel('End Session')
      .setStyle(ButtonStyle.Danger),
  );

  return [row1, row2, row3];
}

module.exports = { nowPlayingButtons };
