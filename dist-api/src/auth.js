"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireApiKey = requireApiKey;
const config_js_1 = require("./config.js");
function requireApiKey(req, res, next) {
    const apiKey = req.header('x-api-key');
    if (!apiKey || apiKey !== config_js_1.bridgeConfig.apiKey) {
        res.status(401).json({
            ok: false,
            error: 'UNAUTHORIZED',
            message: 'Missing or invalid bridge API key.',
        });
        return;
    }
    next();
}
