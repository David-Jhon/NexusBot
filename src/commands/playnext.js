const { SlashCommandBuilder } = require('discord.js');
const { useMainPlayer, useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { buildPlayOptions, applyGuildAutoplay, searchEngineFor } = require('../utils/playback');
const { controlError } = require('../utils/voice');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playnext')
    .setDescription('Play a song immediately after the current track')
    .addStringOption((opt) => opt.setName('query').setDescription('Song name or URL').setRequired(true)),

  async execute(interaction) {
    const channel = interaction.member.voice?.channel;
    if (!channel) {
      return interaction.reply({ embeds: [errorEmbed('Join a voice channel first.')], ephemeral: true });
    }
    // Jumping the queue is a control action, so it needs the same channel as the bot
    const denied = controlError(interaction.member, useQueue(interaction.guildId));
    if (denied) return interaction.reply({ embeds: [errorEmbed(denied)], ephemeral: true });

    const query = interaction.options.getString('query', true);
    const player = useMainPlayer();

    await interaction.deferReply();

    try {
      const searchResult = await player.search(query, {
        requestedBy: interaction.user,
        searchEngine: searchEngineFor(query),
      });
      if (!searchResult?.tracks?.length) {
        return interaction.followUp({ embeds: [errorEmbed('No results found.')] });
      }

      const queue = useQueue(interaction.guildId);
      if (!queue?.currentTrack) {
        // Nothing playing (no queue, or an idle 24/7 queue) — behaves like a normal /play so playback starts
        const { queue: newQueue, track } = await player.play(
          channel,
          searchResult.tracks[0],
          buildPlayOptions(interaction.guildId, { requestedBy: interaction.user, textChannelId: interaction.channelId }),
        );
        applyGuildAutoplay(newQueue);
        return interaction.followUp({ embeds: [successEmbed(`Now playing **${track.title}**`)] });
      }

      const track = searchResult.tracks[0];
      queue.insertTrack(track, 0);
      return interaction.followUp({ embeds: [successEmbed(`**${track.title}** will play next`)] });
    } catch (err) {
      return interaction.followUp({ embeds: [errorEmbed(`Couldn't queue that: ${err.message}`)] });
    }
  },
};
