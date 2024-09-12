"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressCheck = progressCheck;
exports.gameCheck = gameCheck;
const discord_1 = require("../discord");
const satisfactory_api_1 = require("../satisfactory-api");
const lang_1 = require("../lang");
const node_cache_1 = __importDefault(require("node-cache"));
const cache = new node_cache_1.default({ stdTTL: 5 });
const progressMessageId = process.env.DISCORD_PROGRESS_MESSAGE_ID;
const gameMessageId = process.env.DISCORD_GAME_MESSAGE_ID;
let lastPhase;
let lastTechTier;
let lastMileStone;
let lastPlayersConnected;
async function getServerState() {
    const cachedState = cache.get('serverState');
    if (cachedState) {
        return cachedState;
    }
    const body = (0, satisfactory_api_1.prepareBody)('QueryServerState', null);
    const result = await (0, satisfactory_api_1.doCall)(body);
    cache.set('serverState', result, 5);
    return result;
}
async function progressCheck() {
    const serverState = await getServerState();
    const phase = serverState.serverGameState.gamePhase.replace(/.*Phase_([0-9]).*/, '$1');
    const techTier = serverState.serverGameState.techTier;
    let mileStone = serverState.serverGameState.activeSchematic.substr(serverState.serverGameState.activeSchematic.lastIndexOf('.') + 1);
    mileStone = mileStone.replace(/[^a-zA-Z0-9-_]/g, '');
    if (mileStone) {
        mileStone = (0, lang_1.getDisplayName)(lang_1.LangKeys.Schematics, mileStone);
    }
    if (lastPhase !== phase) {
        if (lastPhase) {
            await (0, discord_1.sendMessage)('Phase change', `Phase changed from ${lastPhase} to ${phase}`);
        }
        lastPhase = phase;
    }
    if (lastTechTier !== techTier) {
        if (lastTechTier) {
            await (0, discord_1.sendMessage)('Tech tier change', `Tech tier changed from ${lastTechTier} to ${techTier}`);
        }
        lastTechTier = techTier;
    }
    if (lastMileStone !== mileStone) {
        if (lastMileStone) {
            await (0, discord_1.sendMessage)('Milestone change', `Milestone changed from ${lastMileStone} to ${mileStone}, either completed or just switched`);
        }
        lastMileStone = mileStone;
    }
    const lastUpdated = new Date();
    await (0, discord_1.updateInfo)('Server progress', { Phase: phase, Tier: techTier, Milestone: mileStone, LastUpdated: lastUpdated }, 'Blue', progressMessageId);
}
async function gameCheck() {
    const serverState = await getServerState();
    const connected = serverState.serverGameState.numConnectedPlayers;
    const duration = serverState.serverGameState.totalGameDuration;
    const lastUpdated = new Date();
    if (lastPlayersConnected !== connected) {
        if (lastPlayersConnected) {
            await (0, discord_1.sendMessage)('Player count change', `Player count changed from ${lastPlayersConnected} to ${connected}`);
        }
        lastPlayersConnected = connected;
    }
    await (0, discord_1.updateInfo)('Game state', { Connected: connected, Duration: formatTime(duration), LastUpdated: lastUpdated }, 'Blue', gameMessageId);
}
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600); // Get full hours
    const minutes = Math.floor((seconds % 3600) / 60); // Get remaining minutes
    const secs = seconds % 60; // Get remaining seconds
    // Return the formatted string h:m:s
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}
