const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');

function parseTimeToMs(input) {
  // Accepts "90" (seconds) or "1:30" (mm:ss) or "1:02:03" (hh:mm:ss)
  const parts = input.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  return seconds * 1000;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Seek to a timestamp in the current track')
    .addStringOption((opt) => opt.setName('time').setDescription('Timestamp, e.g. 90 or 1:30').setRequired(true)),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
    }
    const ms = parseTimeToMs(interaction.options.getString('time', true));
    if (ms === null) {
      return interaction.reply({ embeds: [errorEmbed('Invalid time format. Use seconds or mm:ss.')], ephemeral: true });
    }
    await queue.node.seek(ms);
    return interaction.reply({ embeds: [successEmbed(`Seeked to **${interaction.options.getString('time')}**`)] });
  },
};
