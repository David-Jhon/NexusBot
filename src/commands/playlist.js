const { SlashCommandBuilder } = require('discord.js');
const { useMainPlayer, useQueue } = require('discord-player');
const db = require('../database/db');
const { successEmbed, errorEmbed, baseEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Manage your saved playlists')
    .addSubcommand((sub) =>
      sub
        .setName('save')
        .setDescription('Save the current queue as a playlist')
        .addStringOption((opt) => opt.setName('name').setDescription('Playlist name').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('load')
        .setDescription('Load and queue a saved playlist')
        .addStringOption((opt) => opt.setName('name').setDescription('Playlist name').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List your saved playlists'))
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a saved playlist')
        .addStringOption((opt) => opt.setName('name').setDescription('Playlist name').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const ownerId = interaction.user.id;

    if (sub === 'save') {
      const queue = useQueue(guildId);
      if (!queue || (!queue.currentTrack && queue.tracks.size === 0)) {
        return interaction.reply({ embeds: [errorEmbed('Nothing is queued to save.')], ephemeral: true });
      }
      const name = interaction.options.getString('name', true);
      const tracks = [];
      if (queue.currentTrack) tracks.push({ url: queue.currentTrack.url, title: queue.currentTrack.title });
      for (const t of queue.tracks.toArray()) tracks.push({ url: t.url, title: t.title });

      db.savePlaylist(guildId, ownerId, name, tracks);
      return interaction.reply({ embeds: [successEmbed(`Saved playlist **${name}** (${tracks.length} tracks)`)] });
    }

    if (sub === 'load') {
      const channel = interaction.member.voice?.channel;
      if (!channel) {
        return interaction.reply({ embeds: [errorEmbed('Join a voice channel first.')], ephemeral: true });
      }
      const name = interaction.options.getString('name', true);
      const playlist = db.loadPlaylist(guildId, ownerId, name);
      if (!playlist) {
        return interaction.reply({ embeds: [errorEmbed(`No playlist named **${name}** found.`)], ephemeral: true });
      }

      await interaction.deferReply();
      const player = useMainPlayer();
      let queued = 0;
      for (const track of playlist.tracks) {
        try {
          await player.play(channel, track.url, {
            nodeOptions: { metadata: { textChannelId: interaction.channelId } },
          });
          queued++;
        } catch {
          // skip tracks that fail to resolve (e.g. removed from source) and continue
        }
      }
      return interaction.followUp({ embeds: [successEmbed(`Queued **${queued}/${playlist.tracks.length}** tracks from **${name}**`)] });
    }

    if (sub === 'list') {
      const playlists = db.listPlaylists(guildId, ownerId);
      if (!playlists.length) {
        return interaction.reply({ embeds: [errorEmbed('You have no saved playlists in this server.')], ephemeral: true });
      }
      const embed = baseEmbed()
        .setTitle('Your Saved Playlists')
        .setDescription(playlists.map((p) => `• **${p.name}**`).join('\n'));
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name', true);
      const deleted = db.deletePlaylist(guildId, ownerId, name);
      return interaction.reply({
        embeds: [deleted ? successEmbed(`Deleted playlist **${name}**`) : errorEmbed(`No playlist named **${name}** found.`)],
      });
    }
  },
};
