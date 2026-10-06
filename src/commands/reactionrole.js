const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  InteractionContextType,
} = require('discord.js');
const db = require('../database/db');
const { successEmbed, errorEmbed, baseEmbed } = require('../utils/embeds');
const logger = require('../utils/logger');
const {
  STYLES,
  MODES,
  MAX_ROLES,
  parseEmojiInput,
  buildPanelMessage,
  checkRoleManageable,
  fetchPanelMessage,
  refreshPanel,
  clearPanelReaction,
  truncate,
} = require('../utils/reactionRoles');

const capitalize = (s) => s[0].toUpperCase() + s.slice(1);
const styleChoices = STYLES.map((s) => ({ name: capitalize(s), value: s }));
const modeChoices = MODES.map((m) => ({ name: capitalize(m), value: m }));

const panelOption = (opt) =>
  opt.setName('panel').setDescription('The reaction role panel').setRequired(true).setAutocomplete(true);

function jumpLink(panel) {
  return `https://discord.com/channels/${panel.guildId}/${panel.channelId}/${panel.messageId}`;
}

function reply(interaction, embed) {
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

/** Resolve the `panel` option, making sure it belongs to this guild. */
function getGuildPanel(interaction) {
  const panel = db.getPanel(interaction.options.getString('panel', true));
  return panel && panel.guildId === interaction.guildId ? panel : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Let members pick their own roles with reactions, buttons, or a dropdown')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Post a new reaction role panel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Where to post the panel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((opt) => opt.setName('title').setDescription('Panel title').setMaxLength(256).setRequired(true))
        .addStringOption((opt) =>
          opt.setName('style').setDescription('How members pick roles').addChoices(...styleChoices).setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('mode').setDescription('How picks behave (default: Normal)').addChoices(...modeChoices),
        )
        .addStringOption((opt) =>
          opt.setName('description').setDescription('Text shown above the role list').setMaxLength(2000),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('limit')
            .setDescription('Max roles a member can hold from this panel (0 = unlimited)')
            .setMinValue(0)
            .setMaxValue(25),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a role to a panel')
        .addStringOption(panelOption)
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to give').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('emoji').setDescription('Emoji (required for reaction panels, optional otherwise)'),
        )
        .addStringOption((opt) =>
          opt.setName('label').setDescription('Short text shown next to the role').setMaxLength(80),
        )
        .addStringOption((opt) =>
          opt.setName('description').setDescription('One-line description shown under the role').setMaxLength(100),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a role from a panel')
        .addStringOption(panelOption)
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to remove').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('mode')
        .setDescription('Change how a panel behaves')
        .addStringOption(panelOption)
        .addStringOption((opt) => opt.setName('mode').setDescription('New mode').addChoices(...modeChoices))
        .addIntegerOption((opt) =>
          opt
            .setName('limit')
            .setDescription('Max roles a member can hold from this panel (0 = unlimited)')
            .setMinValue(0)
            .setMaxValue(25),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List reaction role panels in this server'))
    .addSubcommand((sub) =>
      sub.setName('delete').setDescription('Delete a panel and its message').addStringOption(panelOption),
    ),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    const choices = db
      .listPanels(interaction.guildId)
      .filter((p) => p.title.toLowerCase().includes(query))
      .slice(0, 25)
      .map((p) => {
        const channel = interaction.guild.channels.cache.get(p.channelId);
        const name = `${p.title} (#${channel?.name ?? 'deleted-channel'}) · ${p.style}/${p.mode}`;
        return { name: name.length > 100 ? `${name.slice(0, 99)}…` : name, value: p.messageId };
      });
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'create') {
      const channel = interaction.options.getChannel('channel', true);
      const style = interaction.options.getString('style', true);
      const mode = interaction.options.getString('mode') ?? 'normal';
      const maxRoles = interaction.options.getInteger('limit') ?? 0;

      if (mode === 'reversed' && style !== 'reaction') {
        return reply(interaction, errorEmbed('**Reversed** mode only works with the **Reaction** style.'));
      }

      const needed = ['ViewChannel', 'SendMessages'];
      if (style === 'reaction') needed.push('AddReactions', 'ReadMessageHistory');
      const missing = channel.permissionsFor(guild.members.me)?.missing(needed) ?? needed;
      if (missing.length) {
        return reply(interaction, errorEmbed(`I'm missing these permissions in ${channel}: ${missing.join(', ')}`));
      }

      const panel = {
        guildId: guild.id,
        channelId: channel.id,
        title: interaction.options.getString('title', true),
        description: interaction.options.getString('description'),
        style,
        mode,
        maxRoles,
        createdBy: interaction.user.id,
      };

      const message = await channel.send(buildPanelMessage(panel, [], guild));
      db.createPanel({ ...panel, messageId: message.id });

      return reply(
        interaction,
        successEmbed(`Panel created in ${channel}: ${message.url}\nNow add roles with \`/reactionrole add\`.`),
      );
    }

    if (sub === 'list') {
      const panels = db.listPanels(guild.id);
      if (!panels.length) return reply(interaction, errorEmbed('No reaction role panels in this server yet.'));

      const lines = panels.slice(0, 25).map(
        (p) =>
          `**${truncate(p.title, 60)}** — [jump](${jumpLink(p)}) · ${p.style} · ${p.mode}` +
          `${p.maxRoles ? ` · limit ${p.maxRoles}` : ''} · ${p.roleCount} role(s)`,
      );
      const embed = baseEmbed().setTitle('Reaction role panels').setDescription(truncate(lines.join('\n'), 4096));
      if (panels.length > 25) embed.setFooter({ text: `Showing 25 of ${panels.length}` });
      return reply(interaction, embed);
    }

    // Remaining subcommands operate on an existing panel
    const panel = getGuildPanel(interaction);
    if (!panel) return reply(interaction, errorEmbed('Panel not found. Pick one from the list.'));

    let fetched;
    try {
      fetched = await fetchPanelMessage(guild, panel);
    } catch (err) {
      // Admins can always remove the DB entry, even if the message is unreachable
      if (sub === 'delete') {
        db.deletePanel(panel.messageId);
        return reply(interaction, successEmbed(`Deleted panel **${panel.title}** (couldn't reach its message to delete it).`));
      }
      logger.warn('ReactionRoles', 'Failed to fetch panel message', { messageId: panel.messageId, err: err.message });
      return reply(
        interaction,
        errorEmbed(`I couldn't reach the panel message. Check that I can view <#${panel.channelId}> and read its history.`),
      );
    }

    if (sub === 'delete') {
      if (fetched.message) await fetched.message.delete().catch(() => null);
      db.deletePanel(panel.messageId);
      return reply(interaction, successEmbed(`Deleted panel **${panel.title}**.`));
    }

    if (fetched.gone) {
      return reply(interaction, errorEmbed('That panel\'s message was deleted, so I removed the panel.'));
    }
    const { message } = fetched;

    if (sub === 'add') {
      const role = interaction.options.getRole('role', true);
      const emojiInput = interaction.options.getString('emoji');
      const label = interaction.options.getString('label');
      const description = interaction.options.getString('description');
      const mappings = db.getReactionRoles(panel.messageId);

      const roleError = checkRoleManageable(guild, role, interaction.member);
      if (roleError) return reply(interaction, errorEmbed(roleError));

      if (mappings.some((m) => m.roleId === role.id)) {
        return reply(interaction, errorEmbed(`${role} is already on this panel.`));
      }
      if (mappings.length >= MAX_ROLES[panel.style]) {
        return reply(interaction, errorEmbed(`A ${panel.style} panel can hold at most ${MAX_ROLES[panel.style]} roles.`));
      }

      let emoji = null;
      if (emojiInput) {
        emoji = parseEmojiInput(emojiInput);
        if (!emoji) return reply(interaction, errorEmbed('That isn\'t a valid emoji. Use a standard emoji or a custom one like `<:name:id>`.'));
        if (emoji.id && !interaction.client.emojis.cache.has(emoji.id)) {
          return reply(interaction, errorEmbed('I can\'t use that custom emoji. It must be from a server I\'m in.'));
        }
        if (mappings.some((m) => m.emojiKey === emoji.key)) {
          return reply(interaction, errorEmbed('That emoji is already used on this panel.'));
        }
      } else if (panel.style === 'reaction') {
        return reply(interaction, errorEmbed('Reaction panels need an `emoji` for each role.'));
      }

      // React first so an emoji Discord rejects never gets saved
      if (panel.style === 'reaction') {
        try {
          await message.react(emoji.raw);
        } catch (err) {
          logger.warn('ReactionRoles', 'Failed to add reaction', { err: err.message });
          return reply(interaction, errorEmbed('I couldn\'t react with that emoji. Is it a valid emoji I can use?'));
        }
      }

      db.addReactionRole(panel.messageId, {
        roleId: role.id,
        emojiKey: emoji?.key ?? null,
        emojiRaw: emoji?.raw ?? null,
        label,
        description,
      });

      try {
        await refreshPanel(guild, panel, message);
      } catch (err) {
        // Most likely an emoji Discord won't accept in a button/menu. Roll back fully.
        db.removeReactionRole(panel.messageId, role.id);
        if (panel.style === 'reaction') await clearPanelReaction(message, emoji.key, interaction.client.user.id);
        await refreshPanel(guild, panel, message).catch(() => null);
        logger.warn('ReactionRoles', 'Failed to update panel', { err: err.message });
        return reply(interaction, errorEmbed(`Couldn't update the panel: ${err.message.slice(0, 200)}`));
      }

      return reply(interaction, successEmbed(`Added ${role} to **${panel.title}**.`));
    }

    if (sub === 'remove') {
      const role = interaction.options.getRole('role', true);
      const mapping = db.getReactionRoles(panel.messageId).find((m) => m.roleId === role.id);
      if (!mapping) return reply(interaction, errorEmbed(`${role} isn't on this panel.`));

      db.removeReactionRole(panel.messageId, role.id);
      if (panel.style === 'reaction' && mapping.emojiKey) {
        await clearPanelReaction(message, mapping.emojiKey, interaction.client.user.id);
      }
      await refreshPanel(guild, panel, message);
      return reply(interaction, successEmbed(`Removed ${role} from **${panel.title}**. Members keep it until removed manually.`));
    }

    if (sub === 'mode') {
      const mode = interaction.options.getString('mode') ?? panel.mode;
      const maxRoles = interaction.options.getInteger('limit') ?? panel.maxRoles;

      if (mode === 'reversed' && panel.style !== 'reaction') {
        return reply(interaction, errorEmbed('**Reversed** mode only works with the **Reaction** style.'));
      }

      const updated = db.updatePanel(panel.messageId, { mode, maxRoles });
      await refreshPanel(guild, updated, message);
      return reply(
        interaction,
        successEmbed(`**${panel.title}** is now **${mode}**${maxRoles ? ` with a limit of ${maxRoles}` : ''}.`),
      );
    }
  },
};
