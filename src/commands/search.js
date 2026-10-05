const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { useMainPlayer, QueryType } = require('discord-player');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { buildPlayOptions, applyGuildAutoplay } = require('../utils/playback');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for a song and pick the exact result you want')
    .addStringOption((opt) => opt.setName('query').setDescription('What to search for').setRequired(true)),

  async execute(interaction) {
    const channel = interaction.member.voice?.channel;
    if (!channel) {
      return interaction.reply({ embeds: [errorEmbed('Join a voice channel first.')], ephemeral: true });
    }

    const query = interaction.options.getString('query', true);
    const player = useMainPlayer();

    await interaction.deferReply();

    const results = await player.search(query, { searchEngine: QueryType.AUTO });
    if (!results?.tracks?.length) {
      return interaction.followUp({ embeds: [errorEmbed('No results found.')] });
    }

    const top = results.tracks.slice(0, 10);
    const menu = new StringSelectMenuBuilder()
      .setCustomId('nexus:searchselect')
      .setPlaceholder('Pick a track to play')
      .addOptions(
        top.map((t, i) => ({
          label: (t.title || 'Untitled').slice(0, 100),
          description: `${t.author || 'Unknown'} • ${t.duration}`.slice(0, 100),
          value: String(i),
        })),
      );

    const reply = await interaction.followUp({
      content: `Results for **${query}**:`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });

    // No `max`: a click from someone else must not use up the requester's pick
    const collector = reply.createMessageComponentCollector({ time: 30_000 });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ embeds: [errorEmbed('Only the requester can pick a result.')], ephemeral: true }).catch(() => null);
      }
      collector.stop('picked');

      // Play the Track object itself: re-resolving its URL could hand a YouTube link to the wrong extractor
      const chosen = top[Number(i.values[0])];
      chosen.requestedBy = interaction.user;

      await i.deferUpdate();

      try {
        const { queue } = await player.play(
          channel,
          chosen,
          buildPlayOptions(interaction.guildId, { requestedBy: interaction.user, textChannelId: interaction.channelId }),
        );
        applyGuildAutoplay(queue);
        await interaction.editReply({ content: null, embeds: [successEmbed(`Queued **${chosen.title}**`)], components: [] });
      } catch (err) {
        await interaction.editReply({ content: null, embeds: [errorEmbed(`Couldn't play that: ${err.message}`)], components: [] });
      }
    });

    collector.on('end', (_collected, reason) => {
      if (reason !== 'picked') {
        interaction.editReply({ content: 'Search timed out.', components: [] }).catch(() => null);
      }
    });
  },
};
