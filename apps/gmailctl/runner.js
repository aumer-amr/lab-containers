const process = require('process');
const express = require('express');
const stoppable = require('stoppable');
const chokidar = require('chokidar');
const { exec } = require("child_process");
const cron = require("node-cron");
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const hat = require('hat');

const port = process.env.PORT || 3000;
const debug = process.env.DEBUG || false;
const tmpDir = process.env.TEMP_DIRECTORY || './tmp';
const allowLabelDeletion = process.env.ALLOW_LABEL_DELETION || false;
const configDir = process.env.CONFIG_DIR || './config';
const dataDir = process.env.DATA_DIR || './data';
const usePolling = process.env.USE_POLLING || false;
const useDataSync = process.env.USE_DATA_SYNC || false;

const logger = pino({
    level: debug ? 'debug' : 'info',
    transport: {
        target: 'pino-pretty'
    },
});

const app = stoppable(express());

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

app.get('/health', (res) => {
    res.sendStatus(200);
});

app.get('/sync', (res) => {
    executeFilters();
    res.sendStatus(200);
});

const rack = hat.rack();

const preprocessConfig = () => {
    let config = fs.readFileSync(`${configDir}/config.jsonnet`, 'utf8');
    config = config.replace(/<config>/, configDir);

    const fileName = `${rack()}.config.jsonnet`;
    fs.writeFileSync(`${tmpDir}/${fileName}`, config);

    return fileName;
}

const postprocessConfig = (fileName) => {
    fs.unlinkSync(`${tmpDir}/${fileName}`);
}

const executeFilters = () => {
    const fileName = preprocessConfig();

    const command = [
        'gmailctl',
        'apply',
        '--config',
        configDir,
        '--yes',
        '--filename',
        `${tmpDir}/${fileName}`
    ];

    if (allowLabelDeletion) command.push('--remove-labels');

    exec(command.join(' '), (error, stdout, stderr) => {
        if (error) {
            logger.error(`An error occurred while reloading the config: ${error.message}`);
            return;
        }
        if (stderr) {
            logger.error(`An error occurred while reloading the config: ${stderr}`);
            return;
        }
        logger.info(`The config was reloaded.`);
        logger.debug(stdout);

        postprocessConfig(fileName);
    });
}

const init = () => {
    exec(`gmailctl init --config ${configDir}`, (error, stdout, stderr) => {
        if (error) {
            logger.error(`An error occurred while initializing gmailctl: ${error.message}`);
            return;
        }
        if (stderr) {
            logger.error(`An error occurred while initializing gmailctl: ${stderr}`);
            return;
        }

        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

        logger.info(`Gmailctl was initialized`);
        logger.debug(stdout);

        cron.schedule("*/15 * * * *", function () {
            exec(`gmailctl init --refresh-expired --config ${configDir}`, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`An error occurred while refreshing the token: ${error.message}`);
                    return;
                }
                if (stderr) {
                    logger.error(`An error occurred while refreshing the token: ${stderr}`);
                    return;
                }
                logger.debug(`The token was refreshed: ${stdout}`);
            });
        });
        
        if (useDataSync && dataDir !== '') {
            if (!fs.existsSync(dataDir)) {
                throw new Error(`The data directory does not exist: ${dataDir}`);
            }

            logger.info(`Data sync is enabled`);

            chokidar.watch(dataDir, {
                usePolling: usePolling,
                ignored: /(^|[\/\\])\../
            })
            .on('add', (filePath, stats) => {
                logger.debug(`File ${filePath} has been added`);
                stats.isFile() && fs.copyFileSync(filePath, path.join(configDir, path.basename(filePath)));
            })
            .on('change', () => {
                logger.debug(`File ${filePath} has been changed`);
                stats.isFile() && fs.copyFileSync(filePath, path.join(configDir, path.basename(filePath)));
            })
            .on('unlink', () => {
                logger.debug(`File ${filePath} has been removed`);
                stats.isFile() && fs.unlinkSync(path.join(configDir, path.basename(filePath)));
            })
            .on('error', (err) => {
                logger.error(`An error occurred while watching the data directory: ${err}`);
                app.shutdown();
            });
        }
        
        chokidar.watch(`${config}/config.jsonnet`, {
            usePolling: usePolling
        })
        .on('add', () => {
            logger.info(`Initial config push.`);
            executeFilters();
        })
        .on('change', () => {
            logger.info(`The config file was updated. Reloading...`);
            executeFilters();
        })
        .on('unlink', () => {
            logger.error(`The config file was deleted. Shutting down...`);
            app.shutdown();
        })
        .on('error', (err) => {
            logger.error(`An error occurred while watching the config directory: ${err}`);
            app.shutdown();
        });
    });
}

app.listen(port, () => {
    logger.info(`Listening at :${port}`);
    if (debug) {
        logger.info('Debug mode is enabled');
    }

    init();
});