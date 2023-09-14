import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createMiddleware, getSummary, getContentType } from '@promster/express';
import GmailOperator from './operator';

const app = express();
app.use(createMiddleware({ app, options: {
    metricPrefix: 'gmail_operator_'
}}));

app.use('/metrics', async (req, res) => {
    req.statusCode = 200;

    res.setHeader('Content-Type', getContentType());
    res.end(await getSummary());
});

app.get('/health', (_: any, res: any) => {
    res.send('OK');
});

const operator = new GmailOperator(app);

const exit = (reason: string) => {
    console.error(`Exiting: ${reason}`);
    operator.stop();
    process.exit(0);
};

process.on('SIGTERM', () => exit('SIGTERM'))
    .on('SIGINT', () => exit('SIGINT'));

(async () => {
    await operator.start();
    app.listen(3000, () => {
        console.log('Listening on port 3000');
    });
})();
