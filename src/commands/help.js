const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { baseEmbed } = require('../utils/embeds');

function musicHelp() {
  return [
    baseEmbed()
      .setTitle('🎵 Music commands')
      .setDescription([
        'Join a voice channel, then:',
        '',
        '`/play` — play a song, playlist or link (YouTube, Spotify, SoundCloud, Deezer…)',
        '`/search` — pick from the top 10 results',
        '`/playnext` — put a song right after the current one',
        '`/skip` · `/pause` · `/resume` · `/stop`',
        '`/queue` · `/nowplaying` · `/remove` · `/shuffle`',
        '`/seek` · `/volume` · `/filters` · `/loop`',
        '`/autoplay` — keep playing similar songs when the queue ends',
        '`/247` — stay in the voice channel all the time',
        '`/playlist` — save and load your own playlists',
        '',
        'Controls only work if you\'re in the same voice channel as the bot.',
        'For self-roles, see `/help reactionrole`.',
      ].join('\n')),
  ];
}

function reactionRoleHelp() {
  const start = baseEmbed()
    .setTitle('🎭 Reaction roles: how to set them up')
    .setDescription([
      'Reaction roles let members give themselves roles by clicking a button, reacting with an emoji, or picking from a menu. You set it up once with two commands.',
      '',
      '**Before you start**',
      '• You need the **Manage Roles** permission.',
      '• Open **Server Settings → Roles** and drag my role **above** every role I should give out. I can\'t give roles that are higher than mine.',
      '',
      '**Step 1: post a panel**',
      '`/reactionrole create` and fill in:',
      '• `channel`: where the panel goes, e.g. #roles',
      '• `title`: e.g. *Pick your color*',
      '• `style`: **Button** is the easiest for members (see the styles below)',
      'I post an empty panel in that channel.',
      '',
      '**Step 2: add roles to it**',
      '`/reactionrole add` and fill in:',
      '• `panel`: start typing the panel\'s title and pick it from the list',
      '• `role`: the role to give, e.g. @Red',
      '• `emoji`: e.g. 🔴 (required for **Reaction** panels, optional for the others)',
      '• `label` / `description`: optional extra text',
      'Run it once for each role. The panel updates by itself.',
      '',
      '**Step 3: done!** Members can pick their roles now.',
      '',
      '**Example**',
      '```',
      '/reactionrole create channel:#roles title:Pick your color style:Button',
      '/reactionrole add panel:Pick your color role:@Red emoji:🔴',
      '/reactionrole add panel:Pick your color role:@Blue emoji:🔵',
      '```',
    ].join('\n'));

  const options = baseEmbed()
    .setTitle('Styles, modes and limits')
    .setDescription([
      '**Style** (picked when you create the panel)',
      '• **Button**: one button per role. Click to get it, click again to remove it. Up to 25 roles.',
      '• **Reaction**: react with the emoji to get the role, remove the reaction to lose it. Up to 20 roles.',
      '• **Dropdown**: a menu; members tick the roles they want. Up to 25 roles.',
      '',
      '**Mode** (optional, **Normal** if you skip it). Change it any time with `/reactionrole mode`.',
      '• **Normal**: get and remove roles freely.',
      '• **Unique**: only one role from the panel at a time. Picking another swaps it. Good for colors.',
      '• **Verify**: roles can be picked but never removed. Good for "I accept the rules".',
      '• **Drop**: picking removes the role.',
      '• **Reversed** (Reaction style only): reacting removes the role, removing the reaction gives it back.',
      '• **Binding**: the first pick is permanent.',
      '',
      '**Limit** (optional): the most roles a member can hold from one panel. `0` means no limit.',
    ].join('\n'));

  const manage = baseEmbed()
    .setTitle('Managing panels and fixing problems')
    .setDescription([
      '`/reactionrole list`: all panels in this server, with links',
      '`/reactionrole remove`: take a role off a panel',
      '`/reactionrole mode`: change a panel\'s mode or limit',
      '`/reactionrole delete`: delete a panel and its message',
      'Deleting the panel message or a role cleans everything up by itself.',
      '',
      '**Something not working?**',
      '• *"…is above or equal to my highest role"*: drag my role higher in **Server Settings → Roles**.',
      '• *"I\'m missing these permissions"*: let me **View Channel**, **Send Messages**, **Add Reactions** and **Read Message History** in that channel.',
      '• *The panel isn\'t in the `panel` list*: type part of its title, or check `/reactionrole list`. It may have been deleted.',
      '• *People add random emojis to a Reaction panel*: deny **Add Reactions** for @everyone in that channel. My own reactions keep working.',
      '• *Nobody can see the command*: it\'s only shown to members with **Manage Roles**.',
    ].join('\n'));

  return [start, options, manage];
}

const TOPICS = { music: musicHelp, reactionrole: reactionRoleHelp };
const HELP_PREFIX = 'nexus:help:';

// One page per message, with Back/Next buttons: nexus:help:<topic>:<page>
function helpPage(topic, page) {
  const pages = TOPICS[topic]();
  const index = Math.min(Math.max(page, 0), pages.length - 1);
  const embed = pages[index];
  if (pages.length === 1) return { embeds: [embed], components: [] };

  embed.setFooter({ text: `Page ${index + 1} of ${pages.length}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${HELP_PREFIX}${topic}:${index - 1}`)
      .setLabel('Back')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === 0),
    new ButtonBuilder()
      .setCustomId(`${HELP_PREFIX}${topic}:${index + 1}`)
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(index === pages.length - 1),
  );
  return { embeds: [embed], components: [row] };
}

function isHelpButton(interaction) {
  return interaction.isButton() && interaction.customId.startsWith(HELP_PREFIX);
}

async function handleHelpButton(interaction) {
  const [topic, page] = interaction.customId.slice(HELP_PREFIX.length).split(':');
  if (!TOPICS[topic]) return;
  await interaction.update(helpPage(topic, Number(page) || 0));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('How to use the bot')
    .addSubcommand((sub) => sub.setName('music').setDescription('Music commands'))
    .addSubcommand((sub) => sub.setName('reactionrole').setDescription('Step-by-step guide to reaction roles')),

  async execute(interaction) {
    const topic = interaction.options.getSubcommand();
    return interaction.reply({ ...helpPage(topic, 0), flags: MessageFlags.Ephemeral });
  },

  isHelpButton,
  handleHelpButton,
};
