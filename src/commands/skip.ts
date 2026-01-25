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

    // Optional: require same VC as the bot
    if (player.voiceChannelId && player.voiceChannelId !== voiceChannel.id) {
      await interaction.editReply("You need to be in the same voice channel as me to skip.");
      return;
    }

    // Try real skip first (works when there's a next item queued)
    try {
      await player.skip(1);
      await interaction.editReply("⏭️ Skipped!");
      return;
    } catch (err: any) {
      // If queue is empty, lavalink-client throws RangeError
      const msg = String(err?.message || err);

      if (msg.includes("Can't skip more than the queue size")) {
        // No next track in queue -> stop current track instead
        if (typeof player.stop === "function") {
          await player.stop();
          await interaction.editReply("⏭️ Skipped! *(queue was empty, stopped current track)*");
          return;
        }

        // fallback if stop() isn't available
        if (typeof player.destroy === "function") {
          await player.destroy();
          await interaction.editReply("⏭️ Skipped! *(queue was empty, stopped & left VC)*");
          return;
        }
      }

      // Unknown error
      console.error("Skip error:", err);
      await interaction.editReply("⚠️ Couldn't skip right now.");
      return;
    }
  } catch (err) {
    console.error("Skip command error:", err);
    await interaction.editReply("⚠️ Couldn't skip right now.");
  }
}