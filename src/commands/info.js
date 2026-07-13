const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

function bar(ratio, length = 10) {
  const filled = Math.round(ratio * length);
  return '`' + '█'.repeat(filled) + '░'.repeat(length - filled) + '`';
}

module.exports = {
  data: new SlashCommandBuilder().setName('info').setDescription('Show bot information'),

  async execute(interaction) {
    const client = interaction.client;
    const uptime = formatUptime(client.uptime);
    const memUsed = process.memoryUsage().heapUsed / 1024 / 1024;
    const memRatio = Math.min(memUsed / 512, 1);
    const pingMs = client.ws.ping;
    const pingRatio = Math.min(pingMs / 500, 1);

    const invite = `https://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=2147485696&scope=bot%20applications.commands`;

    const embed = new EmbedBuilder()
      .setColor(config.brand.color)
      .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
      .setTitle(`${config.brand.name}`)
      .setDescription(`Hey ${interaction.user}, here's what's going on under the hood.`)
      .addFields(
        {
          name: '⏱ Uptime',
          value: `\`${uptime}\``,
          inline: true,
        },
        {
          name: '📡 Ping',
          value: `\`${pingMs}ms\`\n${bar(pingRatio)}`,
          inline: true,
        },
        {
          name: '💾 Memory',
          value: `\`${memUsed.toFixed(0)}MB\`\n${bar(memRatio)}`,
          inline: true,
        },
      )
      .setTimestamp()
      .setFooter({ text: `${interaction.user.tag} asked for this`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Invite Me')
        .setURL(invite)
        .setStyle(ButtonStyle.Link),
    );

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
