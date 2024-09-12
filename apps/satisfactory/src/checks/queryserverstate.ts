import { sendMessage, updateInfo } from "../discord";
import { prepareBody, doCall } from "../satisfactory-api";
import { getDisplayName, LangKeys } from "../lang";
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 5 });
const progressMessageId: string | undefined = process.env.DISCORD_PROGRESS_MESSAGE_ID;
const gameMessageId: string | undefined = process.env.DISCORD_GAME_MESSAGE_ID;

let lastPhase: number;
let lastTechTier: number;
let lastMileStone: string;
let lastPlayersConnected: number;

async function getServerState() {
	const cachedState = cache.get('serverState');
	if (cachedState) {
		return cachedState;
	}

	const body = prepareBody('QueryServerState', null);
	const result = await doCall(body);

	cache.set('serverState', result, 5);

	return result
}

export async function progressCheck() {
	const serverState = await getServerState();

	const phase = serverState.serverGameState.gamePhase.replace(/.*Phase_([0-9]).*/, '$1');
	const techTier = serverState.serverGameState.techTier;
	let mileStone = serverState.serverGameState.activeSchematic.substr(serverState.serverGameState.activeSchematic.lastIndexOf('.') + 1);
	mileStone = mileStone.replace(/[^a-zA-Z0-9-_]/g, '');

	if (mileStone) {
		mileStone = getDisplayName(LangKeys.Schematics, mileStone);
	}

	if (lastPhase !== phase) {
		if (lastPhase) {
			await sendMessage('Phase change', `Phase changed from ${lastPhase} to ${phase}`);
		}
		lastPhase = phase;
	}

	if (lastTechTier !== techTier) {
		if (lastTechTier) {
			await sendMessage('Tech tier change', `Tech tier changed from ${lastTechTier} to ${techTier}`);
		}
		lastTechTier = techTier;
	}

	if (lastMileStone !== mileStone) {
		if (lastMileStone) {
			await sendMessage('Milestone change', `Milestone changed from ${lastMileStone} to ${mileStone}, either completed or just switched`);
		}
		lastMileStone = mileStone;
	}

	const lastUpdated = new Date();

	await updateInfo('Server progress', { Phase: phase, Tier: techTier, Milestone: mileStone, LastUpdated: lastUpdated }, 'Blue', progressMessageId);
}

export async function gameCheck() {
	const serverState = await getServerState();

	const connected = serverState.serverGameState.numConnectedPlayers;
	const duration = serverState.serverGameState.totalGameDuration;
	const lastUpdated = new Date();

	if (lastPlayersConnected !== connected) {
		if (lastPlayersConnected) {
			await sendMessage('Player count change', `Player count changed from ${lastPlayersConnected} to ${connected}`);
		}
		lastPlayersConnected = connected;
	}

	await updateInfo('Game state', { Connected: connected, Duration: formatTime(duration), LastUpdated: lastUpdated }, 'Blue', gameMessageId);
}

function formatTime(seconds: number) {
    const hours = Math.floor(seconds / 3600); // Get full hours
    const minutes = Math.floor((seconds % 3600) / 60); // Get remaining minutes
    const secs = seconds % 60; // Get remaining seconds

    // Return the formatted string h:m:s
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}