import { Client, GatewayIntentBits, Events } from "discord.js";
import { config } from "./config";
import { commands } from "./commands";
import { deployCommands } from "./deploy-commands";
import { lavalink } from "./lavalink";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, async () => {
  console.log("Discord bot is ready! 🤖");
  await lavalink.init({
    id: client.user!.id,
    username: client.user!.username,
  });
});

client.on("guildCreate", async (guild) => {
  await deployCommands({ guildId: guild.id });
});

client.on("raw", (d) => {
  // @ts-ignore
  lavalink.sendRawData(d);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands[interaction.commandName as keyof typeof commands];
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("❌ Command failed.");
    } else {
      await interaction.reply("❌ Command failed.");
    }
  }
});

client.login(config.DISCORD_TOKEN);