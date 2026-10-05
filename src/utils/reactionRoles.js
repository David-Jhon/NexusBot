const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { baseEmbed } = require('./embeds');
const db = require('../database/db');

const STYLES = ['reaction', 'button', 'dropdown'];
const MODES = ['normal', 'unique', 'verify', 'drop', 'reversed', 'binding'];

// Discord caps reactions per message at 20; components at 5 rows x 5 buttons / 25 menu options
const MAX_ROLES = { reaction: 20, button: 25, dropdown: 25 };

const BUTTON_PREFIX = 'nexus:rr:btn:';
const MENU_ID = 'nexus:rr:menu';

const MODE_HINTS = {
  normal: 'Pick a role to get it, pick it again to remove it.',
  unique: 'You can only have one role from this panel.',
  verify: 'Roles from this panel can only be added, not removed.',
  drop: 'Picking a role removes it from you.',
  reversed: 'Reacting removes the role, unreacting gives it back.',
  binding: 'Your first pick is permanent.',
};

const CUSTOM_EMOJI_RE = /^<(a?):([\w~]{1,32}):(\d{17,20})>$/;
// Rough check: input must contain at least one pictographic/regional-indicator/keycap character
const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/**
 * Parse user input into an emoji. Returns { key, raw, id } or null.
 * `key` matches `reaction.emoji.id ?? reaction.emoji.name` for lookups.
 */
function parseEmojiInput(input) {
  const text = input?.trim();
  if (!text) return null;

  const custom = text.match(CUSTOM_EMOJI_RE);
  if (custom) return { key: custom[3], raw: text, id: custom[3] };

  if (text.length > 32 || /\s/.test(text) || !UNICODE_EMOJI_RE.test(text)) return null;
  return { key: text, raw: text, id: null };
}

function emojiKeyFrom(emoji) {
  return emoji.id ?? emoji.name;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function roleLabel(mapping, guild) {
  return truncate(mapping.label || guild.roles.cache.get(mapping.roleId)?.name || 'Unknown role', 80);
}

/** Build the full panel message payload ({ embeds, components }). */
function buildPanelMessage(panel, mappings, guild) {
  const lines = mappings.map((m) => {
    const prefix = m.emojiRaw ? `${m.emojiRaw} ` : '• ';
    const label = m.label ? ` — ${m.label}` : '';
    return `${prefix}<@&${m.roleId}>${label}`;
  });

  const description = [panel.description, lines.join('\n') || '*No roles yet.*'].filter(Boolean).join('\n\n');

  const footer = [MODE_HINTS[panel.mode]];
  if (panel.maxRoles > 0 && panel.mode !== 'unique') footer.push(`Limit: ${panel.maxRoles} role(s).`);

  const embed = baseEmbed()
    .setTitle(panel.title)
    .setDescription(truncate(description, 4096))
    .setFooter({ text: footer.join(' ') });

  const components = [];

  if (panel.style === 'button' && mappings.length) {
    for (let i = 0; i < mappings.length; i += 5) {
      const row = new ActionRowBuilder();
      for (const m of mappings.slice(i, i + 5)) {
        const button = new ButtonBuilder()
          .setCustomId(`${BUTTON_PREFIX}${m.roleId}`)
          .setLabel(roleLabel(m, guild))
          .setStyle(ButtonStyle.Secondary);
        if (m.emojiRaw) button.setEmoji(m.emojiRaw);
        row.addComponents(button);
      }
      components.push(row);
    }
  }

  if (panel.style === 'dropdown' && mappings.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(MENU_ID)
      .setPlaceholder('Select a role to add or remove')
      .setMinValues(1)
      .setMaxValues(panel.mode === 'unique' ? 1 : mappings.length)
      .addOptions(
        mappings.map((m) => {
          const option = { label: roleLabel(m, guild), value: m.roleId };
          if (m.emojiRaw) option.emoji = m.emojiRaw;
          return option;
        }),
      );
    components.push(new ActionRowBuilder().addComponents(menu));
  }

  return { embeds: [embed], components };
}

/**
 * Check that the bot (and the invoking admin) can hand out this role.
 * Returns an error string, or null when the role is usable.
 */
function checkRoleManageable(guild, role, invoker) {
  if (role.id === guild.id) return 'You can\'t use @everyone as a reaction role.';
  if (role.managed) return `${role} is managed by an integration (bot or booster role) and can't be assigned.`;

  const me = guild.members.me;
  if (!me?.permissions.has('ManageRoles')) return 'I need the **Manage Roles** permission.';
  // comparePositionTo breaks position ties by ID, matching Discord's real hierarchy
  if (role.comparePositionTo(me.roles.highest) >= 0) {
    return `${role} is above or equal to my highest role. Move my role above it in Server Settings → Roles.`;
  }

  if (invoker && invoker.id !== guild.ownerId && role.comparePositionTo(invoker.roles.highest) >= 0) {
    return `${role} is above or equal to your highest role.`;
  }
  return null;
}

// Discord error codes that mean the panel is really gone (vs. a transient/permission failure)
const GONE_CODES = new Set([10003, 10008]); // Unknown Channel, Unknown Message

/**
 * Fetch a panel's message. Returns { message } or { gone: true } (panel cleaned up),
 * and throws on transient errors so callers never delete a panel by accident.
 */
async function fetchPanelMessage(guild, panel) {
  try {
    const channel = await guild.channels.fetch(panel.channelId);
    if (!channel?.isTextBased()) throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
    return { message: await channel.messages.fetch(panel.messageId) };
  } catch (err) {
    if (!GONE_CODES.has(err.code)) throw err;
    db.deletePanel(panel.messageId);
    return { gone: true };
  }
}

/** Re-render a panel message from the DB. */
function refreshPanel(guild, panel, message) {
  return message.edit(buildPanelMessage(panel, db.getReactionRoles(panel.messageId), guild));
}

/** Remove an emoji from a panel: everyone's reactions if allowed, otherwise just the bot's. */
async function clearPanelReaction(message, emojiKey, botId) {
  const reaction = message.reactions.cache.get(emojiKey);
  if (!reaction) return;
  await reaction.remove().catch(() => reaction.users.remove(botId).catch(() => null));
}

/**
 * Turn a member's intent into role changes according to the panel's mode.
 *
 * action:
 *  - 'add' / 'remove': reaction added/removed, or explicit dropdown choice
 *  - 'toggle': button click or dropdown pick (add if missing, remove if held)
 *
 * Returns { added, removed, refused, member } where `refused` is a user-facing
 * reason (or null) and `member` is the updated member.
 */
async function applyRoleAction({ member, panel, mappings, roleId, action }) {
  const result = { added: [], removed: [], refused: null, member };
  const panelRoleIds = mappings.map((m) => m.roleId);
  if (!panelRoleIds.includes(roleId)) {
    result.refused = 'That role is no longer part of this panel.';
    return result;
  }

  const has = (id) => result.member.roles.cache.has(id);

  let op = action;
  if (op === 'toggle') op = has(roleId) ? 'remove' : 'add';
  if (panel.mode === 'reversed' && action !== 'toggle') op = op === 'add' ? 'remove' : 'add';
  if (panel.mode === 'drop') op = 'remove';
  if (panel.mode === 'verify' && op === 'remove') {
    if (action === 'toggle') result.refused = 'Roles from this panel can\'t be removed.';
    return result;
  }

  const reason = `Reaction role panel ${panel.messageId}`;

  if (op === 'remove') {
    if (!has(roleId)) return result;
    if (panel.mode === 'binding') {
      result.refused = 'Your pick on this panel is permanent.';
      return result;
    }
    result.member = await result.member.roles.remove(roleId, reason);
    result.removed.push(roleId);
    return result;
  }

  // op === 'add'
  if (has(roleId)) return result;

  const heldOthers = panelRoleIds.filter((id) => id !== roleId && has(id));

  if (panel.mode === 'binding' && heldOthers.length) {
    result.refused = 'You already picked a role from this panel and it\'s permanent.';
    return result;
  }

  if (panel.mode === 'unique') {
    if (heldOthers.length) {
      result.member = await result.member.roles.remove(heldOthers, reason);
      result.removed.push(...heldOthers);
    }
  } else if (panel.maxRoles > 0 && heldOthers.length >= panel.maxRoles) {
    result.refused = `You can only have ${panel.maxRoles} role(s) from this panel.`;
    return result;
  }

  result.member = await result.member.roles.add(roleId, reason);
  result.added.push(roleId);
  return result;
}

/** Short user-facing summary of an applyRoleAction result. */
function describeResult({ added, removed, refused }) {
  const parts = [];
  if (added.length) parts.push(`Added ${added.map((id) => `<@&${id}>`).join(', ')}`);
  if (removed.length) parts.push(`Removed ${removed.map((id) => `<@&${id}>`).join(', ')}`);
  if (refused) parts.push(refused);
  return parts.join('\n') || 'No changes.';
}

module.exports = {
  STYLES,
  MODES,
  MAX_ROLES,
  BUTTON_PREFIX,
  MENU_ID,
  parseEmojiInput,
  emojiKeyFrom,
  buildPanelMessage,
  checkRoleManageable,
  fetchPanelMessage,
  refreshPanel,
  clearPanelReaction,
  applyRoleAction,
  describeResult,
  truncate,
};
