// Who may control the music. Matches the now-playing buttons: you have to be listening.

const humansIn = (channel) => channel.members.filter((m) => !m.user.bot).size;

/**
 * For commands that change playback (stop, volume, loop, seek, ...). Returns an error message,
 * or null when the member may go ahead. Anyone may act when nobody is listening (e.g. to stop an
 * abandoned 24/7 session).
 */
function controlError(member, queue) {
  const botChannel = queue?.channel;
  if (!botChannel || member.voice?.channelId === botChannel.id || humansIn(botChannel) === 0) return null;
  return `Join <#${botChannel.id}> to control the music.`;
}

/**
 * For commands that start music (play, search, playlist load): don't pull the bot away from people
 * listening in another channel.
 */
function busyElsewhereError(member, queue) {
  const botChannel = queue?.channel;
  if (!botChannel || member.voice?.channelId === botChannel.id || humansIn(botChannel) === 0) return null;
  return `I'm already playing in <#${botChannel.id}>. Join that channel to add songs.`;
}

module.exports = { controlError, busyElsewhereError };
