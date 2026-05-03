/**
 * @file realtimeChannels.js
 * @description Supabase Realtime channel registry — creates and caches named channels
 * @module MUMS/Lib
 * @version UAT
 */
const MAX_CHANNELS = 3;

export function createRealtimeChannelManager(supabase) {
  const channels = new Map();

  function getOrCreateChannel(name, builder) {
    const key = String(name || 'default');
    if (channels.has(key)) return channels.get(key);

    if (channels.size >= MAX_CHANNELS) {
      return channels.values().next().value;
    }

    const channel = builder();
    channels.set(key, channel);
    return channel;
  }

  function cleanup() {
    for (const ch of channels.values()) {
      supabase.removeChannel(ch);
    }
    channels.clear();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', cleanup);
  }

  return { getOrCreateChannel, cleanup };
}
