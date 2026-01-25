import {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import { lavalink } from "../lavalink";

export const data = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current song");

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

    // Optional: only allow skip if user is in same VC as bot
    if (player.voiceChannelId && player.voiceChannelId !== voiceChannel.id) {
      await interaction.editReply("You need to be in the same voice channel as me to skip.");
      return;
    }

    // Figure out queue size in a tolerant way (libs differ)
    const queueSize =
      player.queue?.size ??
      player.queue?.length ??
      player.queue?.tracks?.length ??
      0;

    // If there's something queued, skip to it
    if (queueSize > 0) {
      await player.skip(); // lavalink-client: skips forward in queue
      await interaction.editReply("⏭️ Skipped!");
      return;
    }

    // Otherwise stop the current track cleanly
    if (typeof player.stop === "function") {
      await player.stop();
      await interaction.editReply("⏹️ Stopped (no more songs in queue).");
      return;
    }

    // Last resort fallback
    if (typeof player.destroy === "function") {
      await player.destroy();
      await interaction.editReply("⏹️ Stopped (no more songs in queue).");
      return;
    }

    await interaction.editReply("⚠️ Couldn't skip/stop right now.");
  } catch (err) {
    console.error("Skip command error:", err);
    await interaction.editReply("⚠️ Couldn't skip right now.");
  }
}