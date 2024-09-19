import { sendMessage, updateInfo } from "../discord";
import { prepareBody, doCall } from "../satisfactory-api";
import { getDisplayName, LangKeys } from "../lang";
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 5 });
const progressMessageId: string | undefined = process.env.DISCORD_PROGRESS_MESSAGE_ID;
const gameMessageId: string | undefined = process.env.DISCORD_GAME_MESSAGE_ID;
const unknownType = 'Unknown';

let lastPhase: number;
let lastTechTier: number;
let lastMileStone: string;

async function getServerState() {
	const cachedState = cache.get('serverState');
	if (cachedState) {
		return cachedState;
	}

	const body = prepareBody('QueryServerState', null);
	const result = await doCall(body);

	if (result === null) {
		return null;
	}

	cache.set('serverState', result, 5);

	return result
}

export async function progressCheck() {
	const serverState = await getServerState();
	const lastUpdated = new Date();

	if (serverState === null) {
		await updateInfo('Server progress', { Phase: unknownType, Tier: unknownType, Milestone: unknownType, LastUpdated: lastUpdated }, 'Red', progressMessageId);
		return;
	}

	const phase = serverState.serverGameState.gamePhase.replace(/.*Phase_([0-9]).*/, '$1');
	const techTier = serverState.serverGameState.techTier;
	let mileStone = serverState.serverGameState.activeSchematic.substr(serverState.serverGameState.activeSchematic.lastIndexOf('.') + 1);
	mileStone = mileStone.replace(/[^a-zA-Z0-9-_]/g, '');

	if (mileStone !== 'None') {
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
			let message = `Milestone changed from ${lastMileStone} to ${mileStone}`;
			if (mileStone === 'None') {
				message = `Milestone ${lastMileStone} completed`;
			}
			await sendMessage('Milestone change', message);
		}
		lastMileStone = mileStone;
	}

	await updateInfo('Server progress', { Phase: phase, Tier: techTier, Milestone: mileStone, LastUpdated: lastUpdated }, 'Blue', progressMessageId);
}

export async function gameCheck() {
	const serverState = await getServerState();
	const lastUpdated = new Date();

	if (serverState === null) {
		await updateInfo('Game state', { Connected: 0, Duration: unknownType, LastUpdated: lastUpdated }, 'Red', gameMessageId);
		return;
	}

	const connected = serverState.serverGameState.numConnectedPlayers;
	const duration = serverState.serverGameState.totalGameDuration;

	await updateInfo('Game state', { Connected: connected, Duration: formatTime(duration), LastUpdated: lastUpdated }, 'Blue', gameMessageId);
}

function formatTime(seconds: number) {
    const hours = Math.floor(seconds / 3600); // Get full hours
    const minutes = Math.floor((seconds % 3600) / 60); // Get remaining minutes
    const secs = seconds % 60; // Get remaining seconds

    // Return the formatted string h:m:s
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}