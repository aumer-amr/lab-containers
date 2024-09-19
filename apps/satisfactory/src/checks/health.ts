import { updateInfo } from "../discord";
import { prepareBody, doCall } from "../satisfactory-api";

const healthCheckMessageId: string | undefined = process.env.DISCORD_HEALTH_MESSAGE_ID;

export async function healthCheck() {
	const body = prepareBody('healthCheck', { ClientCustomData: null });
	let result = await doCall(body);
	const lastUpdated = new Date();

	if (result === null) {
		result = { health: 'Unknown' };
	}

	await updateInfo('Server Health', { State: result.health, LastUpdated: lastUpdated }, result.health !== 'healthy' ? 'Red' : 'Green', healthCheckMessageId);
}