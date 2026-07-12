const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume (0-150)')
    .addIntegerOption((opt) =>
      opt.setName('level').setDescription('Volume percentage').setMinValue(0).setMaxValue(150).setRequired(true),
    ),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
    }
    const level = interaction.options.getInteger('level', true);
    queue.node.setVolume(level);
    return interaction.reply({ embeds: [successEmbed(`Volume set to **${level}%**`)] });
  },
};
