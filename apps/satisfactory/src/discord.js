"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.sendMessage = sendMessage;
exports.updateInfo = updateInfo;
exports.executeMessage = executeMessage;
const discord_js_1 = require("discord.js");
const checks_1 = __importDefault(require("./checks"));
const client = new discord_js_1.Client({ intents: [] });
client.once(discord_js_1.Events.ClientReady, readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    (0, checks_1.default)();
});
async function login() {
    await client.login(process.env.DISCORD_TOKEN);
}
async function sendMessage(title, message, color = 'Green', messageId) {
    return await executeMessage(process.env.DISCORD_MESSAGE_CHANNEL_ID || "", title, message, color, messageId);
}
async function updateInfo(title, message, color = 'Green', messageId) {
    return await executeMessage(process.env.DISCORD_INFO_CHANNEL_ID || "", title, message, color, messageId);
}
async function executeMessage(channelId, title, message, color = 'Green', messageId) {
    const channel = await client.channels.fetch(channelId || "");
    if (channel) {
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(color)
            .setTitle(title);
        if (typeof message === 'object') {
            embed.addFields(Object.entries(message).map(([name, value]) => ({ name, value: value.toString() })));
        }
        else {
            embed.setDescription(message);
        }
        if (messageId) {
            return await channel.messages.fetch(messageId)
                .then((msg) => msg.edit({ embeds: [embed] }))
                .catch(() => {
                console.error(`Message ${messageId} not found`);
                return null;
            });
        }
        else {
            return await channel.send({ embeds: [embed] });
        }
    }
    else {
        console.error(`Channel ${channelId} not found`);
    }
}
