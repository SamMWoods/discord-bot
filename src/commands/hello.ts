import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("hello")
  .setDescription("Say hello to the bot");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.reply(`Hello ${interaction.user.username}! 👋`);
}
