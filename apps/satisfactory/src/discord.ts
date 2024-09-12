import { Client, ColorResolvable, EmbedBuilder, Events, TextChannel } from 'discord.js';
import checkForUpdates from './checks';

const client = new Client({ intents: [] });

client.once(Events.ClientReady, readyClient => {
	console.log(`Logged in as ${readyClient.user.tag}`);
	checkForUpdates();
});

export async function login() {
	await client.login(process.env.DISCORD_TOKEN);
}

export async function sendMessage(title: string, message: string | object, color: ColorResolvable = 'Green', messageId?: string | null) {
	return await executeMessage(process.env.DISCORD_MESSAGE_CHANNEL_ID || "", title, message, color, messageId);
}

export async function updateInfo(title: string, message: string | object, color: ColorResolvable = 'Green', messageId?: string | null) {
	return await executeMessage(process.env.DISCORD_INFO_CHANNEL_ID || "", title, message, color, messageId);
}

export async function executeMessage(channelId: string, title: string, message: string | object, color: ColorResolvable = 'Green', messageId?: string | null) {
	const channel = await client.channels.fetch(channelId || "");
	if (channel) {
		const embed = new EmbedBuilder()
			.setColor(color)
			.setTitle(title);

		if (typeof message === 'object') {
			embed.addFields(Object.entries(message).map(([name, value]) => ({ name, value: value.toString() })));
		} else {
			embed.setDescription(message);
		}
		
		if (messageId) {
			return await (channel as TextChannel).messages.fetch(messageId)
				.then((msg) => msg.edit({ embeds: [embed] }))
				.catch(() => {
					console.error(`Message ${messageId} not found`);
					return null;
				});
		} else {
			return await (channel as TextChannel).send({ embeds: [embed] });
		}
	} else {
		console.error(`Channel ${channelId} not found`);
	}
}