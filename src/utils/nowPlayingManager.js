const { Collection } = require('discord.js');
const { nowPlayingEmbed } = require('./embeds');
const { nowPlayingButtons } = require('./buttons');

const npMessages = new Collection();
const npIntervals = new Collection();

function getNpMessage(queue) {
  const guildId = queue.guild?.id;
  if (!guildId) return null;
  return npMessages.get(guildId) || null;
}

function stopNpAutoRefresh(queue) {
  const guildId = queue.guild?.id;
  if (!guildId) return;
  const interval = npIntervals.get(guildId);
  if (interval) {
    clearInterval(interval);
    npIntervals.delete(guildId);
  }
}

function startNpAutoRefresh(queue, message) {
  stopNpAutoRefresh(queue);
  const guildId = queue.guild?.id;
  if (!guildId) return;

  const interval = setInterval(async () => {
    if (!queue.currentTrack) {
      stopNpAutoRefresh(queue);
      return;
    }
    try {
      await message.edit({
        embeds: [nowPlayingEmbed(queue.currentTrack, queue)],
        components: nowPlayingButtons(queue),
      });
    } catch {
      stopNpAutoRefresh(queue);
    }
  }, 8_000);

  npIntervals.set(guildId, interval);
}

async function clearNpMessage(queue) {
  const guildId = queue.guild?.id;
  if (!guildId) return;
  stopNpAutoRefresh(queue);
  const msg = npMessages.get(guildId);
  if (!msg) return;
  npMessages.delete(guildId);
  try { await msg.delete(); } catch {}
}

function registerNpMessage(queue, message) {
  const guildId = queue.guild?.id;
  if (guildId) npMessages.set(guildId, message);
}

module.exports = { getNpMessage, clearNpMessage, registerNpMessage, startNpAutoRefresh, stopNpAutoRefresh };
