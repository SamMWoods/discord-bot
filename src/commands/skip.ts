import {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import { lavalink } from "../lavalink";

export const data = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current song");

function getQueueSize(player: any): number {
  // Common shapes across lavalink-client / erela / shoukaku wrappers
  if (!player) return 0;

  // lavalink-client often has queue as an array-like or with "tracks"
  if (typeof player.queue?.size === "number") return player.queue.size;
  if (typeof player.queue?.length === "number") return player.queue.length;
  if (typeof player.queue?.tracks?.length === "number") return player.queue.tracks.length;

  // Some libs keep queue internally as "data" or similar
  if (typeof player.queue?.data?.length === "number") return player.queue.data.length;

  return 0;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  try {
    if (!interaction.guildId) {
      await interaction.editReply("This command can only be used in a server.");
      return;
    }

    const member = interaction.member as GuildMember | null;
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.editReply("Join a voice channel first.");
      return;
    }

    const player: any = lavalink.getPlayer(interaction.guildId);
    if (!player) {
      await interaction.editReply("Nothing is playing right now.");
      return;
    }

    console.log("QUEUE DEBUG", {
      queue: player.queue,
      keys: player.queue ? Object.keys(player.queue) : null,
    });

    // Optional: ensure same VC
    if (player.voiceChannelId && player.voiceChannelId !== voiceChannel.id) {
      await interaction.editReply("You need to be in the same voice channel as me to skip.");
      return;
    }

    const queueSize = getQueueSize(player);

    // If there is something queued, move forward
    if (queueSize > 0) {
      await player.skip(1); // explicit 1 helps some versions
      await interaction.editReply("⏭️ Skipped!");
      return;
    }

    // No queue -> stop current track instead of calling skip()
    if (typeof player.stop === "function") {
      await player.stop();
      await interaction.editReply("⏭️ Skipped! *(queue empty, stopped current track)*");
      return;
    }

    if (typeof player.destroy === "function") {
      await player.destroy();
      await interaction.editReply("⏭️ Skipped! *(queue empty, stopped & left VC)*");
      return;
    }

    await interaction.editReply("⚠️ Couldn't skip/stop right now.");
  } catch (err) {
    console.error("Skip command error:", err);
    await interaction.editReply("⚠️ Couldn't skip right now.");
  }
}
