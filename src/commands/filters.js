const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');

// A curated subset of discord-player's 64+ built-in ffmpeg filter presets.
// Full list is available via queue.filters.ffmpeg.availableFilters if you
// want to expose all of them later (e.g. as a select-menu).
const FILTER_CHOICES = [
  'bassboost', 'nightcore', 'vaporwave', '8D', 'karaoke', 'reverse',
  'surrounding', 'lofi', 'tremolo', 'vibrato', 'normalizer',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('filters')
    .setDescription('Toggle an audio filter on the current playback')
    .addStringOption((opt) =>
      opt
        .setName('filter')
        .setDescription('Filter to toggle')
        .setRequired(true)
        .addChoices(...FILTER_CHOICES.map((f) => ({ name: f, value: f }))),
    ),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
    }

    const filter = interaction.options.getString('filter', true);
    const active = queue.filters.ffmpeg.getFiltersEnabled();
    const isActive = active.includes(filter);

    // Toggling restarts the stream, which can take longer than Discord's 3s reply window
    await interaction.deferReply();
    await queue.filters.ffmpeg.toggle(filter);

    return interaction.editReply({
      embeds: [successEmbed(`Filter **${filter}** ${isActive ? 'disabled' : 'enabled'}`)],
    });
  },
};
