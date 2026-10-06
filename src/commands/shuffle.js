const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { controlError } = require('../utils/voice');
const queueManager = require('../structures/queueManager');

module.exports = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the current queue'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || queue.tracks.size < 2) {
      return interaction.reply({ embeds: [errorEmbed('Not enough tracks in queue to shuffle.')], ephemeral: true });
    }
    const denied = controlError(interaction.member, queue);
    if (denied) return interaction.reply({ embeds: [errorEmbed(denied)], ephemeral: true });
    queue.tracks.shuffle();
    queueManager.scheduleSnapshot(interaction.guildId); // so a restart keeps the new order
    return interaction.reply({ embeds: [successEmbed('Queue shuffled.')] });
  },
};
