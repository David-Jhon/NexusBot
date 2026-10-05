const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');

function parseTimeToMs(input) {
  // Accepts "90" (seconds) or "1:30" (mm:ss) or "1:02:03" (hh:mm:ss)
  const parts = input.trim().split(':');
  if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + Number(p);
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
    const time = interaction.options.getString('time', true);
    const ms = parseTimeToMs(time);
    if (ms === null) {
      return interaction.reply({ embeds: [errorEmbed('Invalid time format. Use seconds or mm:ss.')], ephemeral: true });
    }
    const length = queue.currentTrack.durationMS;
    if (!length) {
      return interaction.reply({ embeds: [errorEmbed('Can\'t seek in a live stream.')], ephemeral: true });
    }
    if (ms >= length) {
      return interaction.reply({
        embeds: [errorEmbed(`That's past the end of the track (**${queue.currentTrack.duration}**).`)],
        ephemeral: true,
      });
    }

    // Seeking restarts the stream, which can take longer than Discord's 3s reply window
    await interaction.deferReply();
    const ok = await queue.node.seek(ms);
    return interaction.editReply({
      embeds: [ok ? successEmbed(`Seeked to **${time}**`) : errorEmbed('Couldn\'t seek in this track.')],
    });
  },
};
