import {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import { lavalink } from "../lavalink";

export const data = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current song");

async function doSkip(player: any) {
  // Prefer a dedicated skip method if the lib has it
  if (typeof player.skip === "function") {
    await player.skip();
    return;
  }

  // Common across many Lavalink clients: stopping current track advances queue
  if (typeof player.stop === "function") {
    await player.stop();
    return;
  }

  // Some libs call it stopTrack
  if (typeof player.stopTrack === "function") {
    await player.stopTrack();
    return;
  }

  // Fallback: some libs keep current track in player.track and queue in player.queue
  // If you have access to a queue object with a "skip" method:
  if (player.queue && typeof player.queue.skip === "function") {
    await player.queue.skip();
    return;
  }

  throw new Error("No supported skip/stop method found on player.");
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

    const player = lavalink.getPlayer(interaction.guildId) as any;

    if (!player) {
      await interaction.editReply("Nothing is playing right now.");
      return;
    }

    // Optional but recommended: only let users in the same VC skip
    const botVcId =
      player.voiceChannelId ??
      player.voiceChannel ??
      player.options?.voiceChannelId;

    if (botVcId && botVcId !== voiceChannel.id) {
      await interaction.editReply("You need to be in the same voice channel as me to skip.");
      return;
    }

    // If your lib exposes a playing flag, keep this
    if (typeof player.playing === "boolean" && player.playing === false) {
      await interaction.editReply("Nothing is playing right now.");
      return;
    }

    await doSkip(player);

    await interaction.editReply("⏭️ Skipped!");
  } catch (err) {
    console.error("Skip command error:", err);
    await interaction.editReply("⚠️ Couldn't skip right now.");
  }
}
