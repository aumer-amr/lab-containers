"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareBody = prepareBody;
exports.doCall = doCall;
const node_https_1 = __importDefault(require("node:https"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const apiUrl = process.env.SATISFACTORY_API_URL || 'https://localhost:7777/api/v1';
const httpsAgent = new node_https_1.default.Agent({
    rejectUnauthorized: false,
});
function prepareBody(functionName, data) {
    return {
        function: functionName,
        data: data,
    };
}
async function doCall(body) {
    try {
        const result = await (0, node_fetch_1.default)(apiUrl, {
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
    }
    catch (error) {
        console.error('Error calling satisfactory-api:', error);
        throw error;
    }
}
