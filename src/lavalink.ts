import { LavalinkManager } from "lavalink-client";
import { client } from "./index"; // <- imports your discord client
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
    // Discord.js v14 voice updates -> Lavalink
    client.guilds.cache.get(guildId)?.shard?.send(payload);
  },
});
