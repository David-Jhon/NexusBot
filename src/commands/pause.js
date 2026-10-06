const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { controlError } = require('../utils/voice');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
    }
    const denied = controlError(interaction.member, queue);
    if (denied) return interaction.reply({ embeds: [errorEmbed(denied)], ephemeral: true });
    queue.node.setPaused(true);
    return interaction.reply({ embeds: [successEmbed('Paused.')] });
  },
};
