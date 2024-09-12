"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = checkForUpdates;
const node_cron_1 = __importDefault(require("node-cron"));
const health_1 = require("./checks/health");
const queryserverstate_1 = require("./checks/queryserverstate");
async function checkForUpdates() {
    node_cron_1.default.schedule(process.env.CRON_SCHEDULE || '*/10 * * * * *', () => {
        console.log('Checking for updates...');
        (0, health_1.healthCheck)();
        (0, queryserverstate_1.progressCheck)();
        (0, queryserverstate_1.gameCheck)();
    });
}
