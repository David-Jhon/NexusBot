const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { nowPlayingEmbed, errorEmbed } = require('../utils/embeds');
const { nowPlayingButtons } = require('../utils/buttons');

module.exports = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the currently playing track'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
    }
    return interaction.reply({
      embeds: [nowPlayingEmbed(queue.currentTrack, queue)],
      components: [nowPlayingButtons(queue)],
    });
  },
};
