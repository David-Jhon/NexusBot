const db = require('../database/db');
const logger = require('./logger');
const { errorEmbed, baseEmbed } = require('./embeds');
const {
  BUTTON_PREFIX,
  MENU_ID,
  emojiKeyFrom,
  buildPanelMessage,
  applyRoleAction,
  describeResult,
} = require('./reactionRoles');

// Fetch fresh so role state is accurate (we don't have the GuildMembers intent to keep the cache in sync)
function fetchMember(guild, userId) {
  return guild.members.fetch({ user: userId, force: true });
}

// Serialize role changes per member so rapid clicks/reactions can't race (e.g. two unique picks both landing)
const memberLocks = new Map();

function withMemberLock(guildId, userId, fn) {
  const key = `${guildId}:${userId}`;
  const run = (memberLocks.get(key) ?? Promise.resolve()).then(() => fn());
  const tail = run.catch(() => null);
  memberLocks.set(key, tail);
  tail.then(() => {
    if (memberLocks.get(key) === tail) memberLocks.delete(key);
  });
  return run;
}

// Reactions the bot removed itself. Their messageReactionRemove events must be ignored,
// otherwise e.g. reversed mode would treat our cleanup as "unreact" and hand the role back.
const botRemovals = new Set();
const BOT_REMOVAL_TTL_MS = 30_000;

const removalKey = (messageId, userId, emojiKey) => `${messageId}:${userId}:${emojiKey}`;

/** Remove a member's reaction for the given emoji keys (best effort, needs Manage Messages). */
async function removeUserReactions(message, userId, emojiKeys) {
  for (const key of emojiKeys) {
    const reaction = message.reactions.cache.get(key);
    if (!reaction) continue;
    const id = removalKey(message.id, userId, key);
    botRemovals.add(id);
    setTimeout(() => botRemovals.delete(id), BOT_REMOVAL_TTL_MS).unref();
    await reaction.users.remove(userId).catch(() => botRemovals.delete(id));
  }
}

/** messageReactionAdd / messageReactionRemove on a reaction-style panel. */
async function handleReaction(reaction, user, action) {
  try {
    const panel = db.getPanel(reaction.message.id);
    if (!panel || panel.style !== 'reaction') return;
    if (user.bot) return;

    // Emoji info is present even on partial reactions, so check the mapping before any API call
    const emojiKey = emojiKeyFrom(reaction.emoji);
    const mappings = db.getReactionRoles(panel.messageId);
    const mapping = mappings.find((m) => m.emojiKey === emojiKey);
    if (!mapping) return;

    if (action === 'remove' && botRemovals.delete(removalKey(panel.messageId, user.id, emojiKey))) return;

    if (reaction.partial) await reaction.fetch();
    const { message } = reaction;
    if (message.partial) await message.fetch();

    const guild = message.guild;
    const result = await withMemberLock(guild.id, user.id, async () => {
      const member = await fetchMember(guild, user.id).catch(() => null);
      if (!member || member.user.bot) return null;

      const res = await applyRoleAction({ member, panel, mappings, roleId: mapping.roleId, action });

      if (action === 'add') {
        // Keep reactions in sync with roles: drop the refused reaction and any the mode took away.
        // In reversed mode a reaction *means* "role removed", so the reacted emoji stays.
        const keepReacted = panel.mode === 'reversed';
        const staleKeys = mappings
          .filter(
            (m) =>
              (res.removed.includes(m.roleId) && !(keepReacted && m.roleId === mapping.roleId)) ||
              (res.refused && m.roleId === mapping.roleId),
          )
          .map((m) => m.emojiKey);
        if (panel.mode === 'drop') staleKeys.push(mapping.emojiKey);
        await removeUserReactions(message, user.id, [...new Set(staleKeys)]);
      }
      return res;
    });

    if (result && (result.added.length || result.removed.length)) {
      logger.info('ReactionRoles', 'Roles updated', {
        guildId: guild.id,
        userId: user.id,
        added: result.added,
        removed: result.removed,
      });
    }
  } catch (err) {
    logger.warn('ReactionRoles', `Failed to handle reaction ${action}`, {
      messageId: reaction.message?.id,
      err: err.message,
    });
  }
}

function isReactionRoleComponent(interaction) {
  return (
    (interaction.isButton() && interaction.customId.startsWith(BUTTON_PREFIX)) ||
    (interaction.isStringSelectMenu() && interaction.customId === MENU_ID)
  );
}

/** Button click or dropdown selection on a button/dropdown panel. */
async function handleComponent(interaction) {
  const panel = db.getPanel(interaction.message.id);
  if (!panel) {
    return interaction.reply({ embeds: [errorEmbed('This panel no longer exists.')], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const mappings = db.getReactionRoles(panel.messageId);
    const roleIds = interaction.isButton()
      ? [interaction.customId.slice(BUTTON_PREFIX.length)]
      : interaction.values;

    const total = { added: [], removed: [], refused: null };

    await withMemberLock(interaction.guild.id, interaction.user.id, async () => {
      let member = await fetchMember(interaction.guild, interaction.user.id);
      for (const roleId of roleIds) {
        const result = await applyRoleAction({ member, panel, mappings, roleId, action: 'toggle' });
        member = result.member;
        total.added.push(...result.added);
        total.removed.push(...result.removed);
        total.refused = result.refused ?? total.refused;
      }
    });

    // Reset the dropdown so the member's selection doesn't linger in the UI.
    // Rebuild from the DB (not the interaction's copy) so a concurrent admin edit isn't overwritten.
    if (interaction.isStringSelectMenu()) {
      const fresh = db.getPanel(panel.messageId);
      if (fresh) {
        const { components } = buildPanelMessage(fresh, db.getReactionRoles(panel.messageId), interaction.guild);
        await interaction.message.edit({ components }).catch(() => null);
      }
    }

    const changed = total.added.length || total.removed.length;
    const embed = changed ? baseEmbed().setDescription(describeResult(total)) : errorEmbed(total.refused ?? 'No changes.');
    return interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.warn('ReactionRoles', 'Failed to handle component', { messageId: panel.messageId, err: err.message });
    const reason = err.code === 50013
      ? 'I don\'t have permission to manage that role. Ask an admin to move my role higher.'
      : 'Something went wrong updating your roles.';
    return interaction.editReply({ embeds: [errorEmbed(reason)] });
  }
}

module.exports = { handleReaction, isReactionRoleComponent, handleComponent };
