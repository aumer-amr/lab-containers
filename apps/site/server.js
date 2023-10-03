const process = require('process');
const logger = require('pino')();
const express = require('express');
const helmet = require('helmet');
const stoppable = require('stoppable');
const path = require('path');
const ipRangeCheck = require('ip-range-check');

const port = process.env.PORT || 3000;
const debug = process.env.DEBUG || false;

const app = stoppable(express());

app.set('trust proxy', true);
app.use(helmet());

process.on('SIGINT', function onSigint() {
    app.shutdown();
});

process.on('SIGTERM', function onSigterm() {
    app.shutdown();
});

app.shutdown = function () {
    app.stop(function onServerClosed(err) {
        if (err) {
            logger.error(`An error occurred while closing the server: ${err}`);
            process.exitCode = 1;
        }
    });
    process.exit();
}

app.use('*', (req, _, next) => {
    if (debug) {
        const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        logger.info(`${clientIp} ${req.method} ${req.originalUrl}`);
    }
    next();
});

app.get('/health', (req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (ipRangeCheck(clientIp, ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) === false) {
        return next();
    }
    res.sendStatus(200);
});

app.use('/favicon.png', (_, res) => res.sendFile(path.join(__dirname, 'assets/favicon.png')));
app.use('/logo.png', (_, res) => res.sendFile(path.join(__dirname, 'assets/logo.png')));
app.use('/style.css', (_, res) => res.sendFile(path.join(__dirname, 'assets/style.css')));
app.use('/robots.txt', (_, res) => res.sendFile(path.join(__dirname, 'assets/robots.txt')));
app.use('/', (_, res) => res.sendFile(path.join(__dirname, 'assets/index.html')));

app.listen(port, () => {
    logger.info(`Listening at :${port}`);
    if (debug) {
        logger.info('Debug mode is enabled');
    }
});