"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = healthCheck;
const discord_1 = require("../discord");
const satisfactory_api_1 = require("../satisfactory-api");
const healthCheckMessageId = process.env.DISCORD_HEALTH_MESSAGE_ID;
async function healthCheck() {
    const body = (0, satisfactory_api_1.prepareBody)('healthCheck', { ClientCustomData: null });
    const result = await (0, satisfactory_api_1.doCall)(body);
    console.log('Health check result:', result.health);
    const lastUpdated = new Date();
    await (0, discord_1.updateInfo)('Server Health', { State: result.health, LastUpdated: lastUpdated }, result.health !== 'healthy' ? 'Red' : 'Green', healthCheckMessageId);
}
