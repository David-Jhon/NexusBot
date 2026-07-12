const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue by its position')
    .addIntegerOption((opt) => opt.setName('position').setDescription('Position in queue (from /queue)').setMinValue(1).setRequired(true)),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || queue.tracks.size === 0) {
      return interaction.reply({ embeds: [errorEmbed('Queue is empty.')], ephemeral: true });
    }
    const position = interaction.options.getInteger('position', true) - 1;
    const track = queue.tracks.at(position);
    if (!track) {
      return interaction.reply({ embeds: [errorEmbed('No track at that position.')], ephemeral: true });
    }
    queue.removeTrack(track);
    return interaction.reply({ embeds: [successEmbed(`Removed **${track.title}**`)] });
  },
};
