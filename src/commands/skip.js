const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const db = require('../database/db');

module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track (vote-skip if enabled)'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
    }

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel || voiceChannel.id !== queue.channel.id) {
      return interaction.reply({ embeds: [errorEmbed('You must be in the same voice channel to skip.')], ephemeral: true });
    }

    const listeners = voiceChannel.members.filter((m) => !m.user.bot).size;
    const settings = db.getGuildSettings(interaction.guildId);

    // Skip immediately if there's only one listener, otherwise honor vote-skip threshold
    if (listeners <= 1) {
      const skipped = queue.currentTrack.title;
      queue.node.skip();
      return interaction.reply({ embeds: [successEmbed(`Skipped **${skipped}**`)] });
    }

    if (!queue.__voteSkips) queue.__voteSkips = new Set();
    queue.__voteSkips.add(interaction.user.id);

    const required = Math.ceil(listeners * settings.voteSkipThreshold);
    if (queue.__voteSkips.size >= required) {
      const skipped = queue.currentTrack.title;
      queue.node.skip();
      queue.__voteSkips.clear();
      return interaction.reply({ embeds: [successEmbed(`Vote passed — skipped **${skipped}**`)] });
    }

    return interaction.reply({
      embeds: [successEmbed(`Vote to skip: **${queue.__voteSkips.size}/${required}**`)],
    });
  },
};
