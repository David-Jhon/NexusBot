const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the current queue'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || queue.tracks.size < 2) {
      return interaction.reply({ embeds: [errorEmbed('Not enough tracks in queue to shuffle.')], ephemeral: true });
    }
    queue.tracks.shuffle();
    return interaction.reply({ embeds: [successEmbed('Queue shuffled.')] });
  },
};
