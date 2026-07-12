const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { queueEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue')
    .addIntegerOption((opt) => opt.setName('page').setDescription('Page number').setMinValue(1)),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
    }
    const page = (interaction.options.getInteger('page') || 1) - 1;
    return interaction.reply({ embeds: [queueEmbed(queue, page)] });
  },
};
