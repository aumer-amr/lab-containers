import https from 'node:https';
import fetch from 'node-fetch';

const apiUrl = process.env.SATISFACTORY_API_URL || 'https://localhost:7777/api/v1';
const httpsAgent = new https.Agent({
	rejectUnauthorized: false,
});

export function prepareBody(functionName: string, data: unknown) {
	return {
		function: functionName,
		data: data,
	};
}

export async function doCall(body: unknown) {
	try {
		const result = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${process.env.SATISFACTORY_API_TOKEN}`,
			},
			body: JSON.stringify(body),
			agent: httpsAgent
		});

		const data = await result.json();
		return data.data;
	} catch (error) {
		console.error('Error calling satisfactory-api:', error);
		return null;
	}
}