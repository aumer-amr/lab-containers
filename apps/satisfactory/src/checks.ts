import cron from 'node-cron';
import { healthCheck } from './checks/health';
import { gameCheck, progressCheck } from './checks/queryserverstate';

export default async function checkForUpdates() {
	cron.schedule(process.env.CRON_SCHEDULE || '*/10 * * * * *', () => {
		console.log('Checking for updates...');
		healthCheck();
		progressCheck();
		gameCheck();
	});
}


