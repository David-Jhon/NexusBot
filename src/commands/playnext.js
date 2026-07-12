const { SlashCommandBuilder } = require('discord.js');
const { useMainPlayer, useQueue } = require('discord-player');
const { successEmbed, errorEmbed } = require('../utils/embeds');

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

    const query = interaction.options.getString('query', true);
    const player = useMainPlayer();

    await interaction.deferReply();

    try {
      const searchResult = await player.search(query, { requestedBy: interaction.user });
      if (!searchResult?.tracks?.length) {
        return interaction.followUp({ embeds: [errorEmbed('No results found.')] });
      }

      let queue = useQueue(interaction.guildId);
      if (!queue) {
        // No active queue yet — behaves like a normal /play
        const { queue: newQueue, track } = await player.play(channel, searchResult.tracks[0], {
          nodeOptions: { metadata: { textChannelId: interaction.channelId } },
        });
        return interaction.followUp({ embeds: [successEmbed(`Queued **${track.title}**`)] });
      }

      const track = searchResult.tracks[0];
      queue.insertTrack(track, 0);
      return interaction.followUp({ embeds: [successEmbed(`**${track.title}** will play next`)] });
    } catch (err) {
      return interaction.followUp({ embeds: [errorEmbed(`Couldn't queue that: ${err.message}`)] });
    }
  },
};
