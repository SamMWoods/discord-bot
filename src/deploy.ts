import { deployCommands } from "./deploy-commands";
import { config } from "./config";

deployCommands({ guildId: config.DISCORD_GUILD_ID })
  .then(() => console.log("Deployed guild commands ✅"))
  .catch(console.error);
