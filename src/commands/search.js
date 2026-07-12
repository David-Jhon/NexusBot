const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { useMainPlayer, QueryType } = require('discord-player');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const db = require('../database/db');

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
          label: t.title.slice(0, 100),
          description: `${t.author || 'Unknown'} • ${t.duration}`.slice(0, 100),
          value: String(i),
        })),
      );

    const reply = await interaction.followUp({
      content: `Results for **${query}**:`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });

    const collector = reply.createMessageComponentCollector({ time: 30_000, max: 1 });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ embeds: [errorEmbed('Only the requester can pick a result.')], ephemeral: true });
      }

      const chosen = top[Number(i.values[0])];
      const settings = db.getGuildSettings(interaction.guildId);

      await i.deferUpdate();

      try {
        await player.play(channel, chosen.url, {
          nodeOptions: {
            metadata: { textChannelId: interaction.channelId },
            volume: settings.defaultVolume,
            leaveOnEmpty: !settings.twentyFourSeven,
            leaveOnEnd: !settings.twentyFourSeven,
            leaveOnStop: !settings.twentyFourSeven,
          },
        });
        await interaction.editReply({ content: null, embeds: [successEmbed(`Queued **${chosen.title}**`)], components: [] });
      } catch (err) {
        await interaction.editReply({ content: null, embeds: [errorEmbed(`Couldn't play that: ${err.message}`)], components: [] });
      }
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        interaction.editReply({ content: 'Search timed out.', components: [] }).catch(() => null);
      }
    });
  },
};
