const { EmbedBuilder } = require('discord.js');
const config = require('../config');

function baseEmbed() {
  return new EmbedBuilder().setColor(config.brand.color);
}

function nowPlayingEmbed(track, queue) {
  const progress = queue.node.createProgressBar?.() || null;
  const embed = baseEmbed()
    .setAuthor({ name: 'Now Playing' })
    .setTitle(track.title)
    .setURL(track.url)
    .setThumbnail(track.thumbnail)
    .addFields(
      { name: 'Duration', value: track.duration || 'Live', inline: true },
      { name: 'Requested by', value: track.requestedBy ? `<@${track.requestedBy.id}>` : 'Unknown', inline: true },
      { name: 'Source', value: track.source || 'unknown', inline: true },
    );

  if (progress) embed.addFields({ name: 'Progress', value: progress });

  return embed;
}

function queueEmbed(queue, page = 0, pageSize = 10) {
  const tracks = queue.tracks.toArray();
  const start = page * pageSize;
  const slice = tracks.slice(start, start + pageSize);

  const lines = slice.map((t, i) => `**${start + i + 1}.** ${t.title} — \`${t.duration}\``);

  const embed = baseEmbed()
    .setTitle('Queue')
    .setDescription(
      (queue.currentTrack ? `**Now Playing:** ${queue.currentTrack.title}\n\n` : '') +
        (lines.length ? lines.join('\n') : '*Queue is empty*'),
    )
    .setFooter({ text: `${tracks.length} track(s) in queue` });

  return embed;
}

function successEmbed(message) {
  return baseEmbed().setDescription(`✅ ${message}`);
}

function errorEmbed(message) {
  return baseEmbed().setColor(0xed4245).setDescription(`❌ ${message}`);
}

module.exports = { nowPlayingEmbed, queueEmbed, successEmbed, errorEmbed, baseEmbed };
