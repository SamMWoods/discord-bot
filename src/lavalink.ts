import { LavalinkManager } from "lavalink-client";
import { client } from "./index";
import { config } from "./config";

export const lavalink = new LavalinkManager({
  nodes: [
    {
      id: "local",
      host: config.LAVALINK_HOST,
      port: config.LAVALINK_PORT,
      authorization: config.LAVALINK_PASSWORD,
      secure: false,
    },
  ],

  sendToShard: (guildId, payload) => {
    client.guilds.cache.get(guildId)?.shard?.send(payload);
  },

  autoSkip: true,
  playerOptions: {
    clientBasedPositionUpdateInterval: 150,
    defaultSearchPlatform: "ytsearch",
    volumeDecrementer: 0.75,
    onDisconnect: {
      autoReconnect: true,
      destroyPlayer: false,
    },
  },
});

lavalink.nodeManager.on("error", (node, error) => {
  console.error(`[Lavalink] Node ${node.id} error:`, error);
});

lavalink.nodeManager.on("connect", (node) => {
  console.log(`[Lavalink] Node ${node.id} connected`);
});

lavalink.nodeManager.on("disconnect", (node, reason) => {
  console.warn(`[Lavalink] Node ${node.id} disconnected:`, reason);
});

// Forward Discord raw gateway events to Lavalink
client.on("raw", (d) => {
  lavalink.sendRawData(d);
});