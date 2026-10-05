const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const db = require('../database/db');

/**
 * Shared by /skip and the now-playing Skip button.
 * Returns { error } or { skipped, text }. Votes reset on every track start (see events/player).
 */
function voteSkip(queue, member) {
  const voiceChannel = member.voice?.channel;
  if (!voiceChannel || voiceChannel.id !== queue.channel?.id) {
    return { error: 'You must be in the same voice channel to skip.' };
  }

  const listeners = voiceChannel.members.filter((m) => !m.user.bot);
  const title = queue.currentTrack.title;

  // Skip immediately if there's only one listener, otherwise honor vote-skip threshold
  if (listeners.size <= 1) {
    queue.node.skip();
    return { skipped: true, text: `Skipped **${title}**` };
  }

  if (!queue.__voteSkips) queue.__voteSkips = new Set();
  queue.__voteSkips.add(member.id);

  // Only count voters who are still listening
  const votes = [...queue.__voteSkips].filter((id) => listeners.has(id)).length;
  const required = Math.ceil(listeners.size * db.getGuildSettings(queue.guild.id).voteSkipThreshold);
  if (votes >= required) {
    queue.__voteSkips.clear();
    queue.node.skip();
    return { skipped: true, text: `Vote passed — skipped **${title}**` };
  }
  return { skipped: false, text: `Vote to skip: **${votes}/${required}**` };
}

module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track (vote-skip if enabled)'),
  voteSkip,

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
    }

    const result = voteSkip(queue, interaction.member);
    if (result.error) {
      return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
    }
    return interaction.reply({ embeds: [successEmbed(result.text)] });
  },
};
