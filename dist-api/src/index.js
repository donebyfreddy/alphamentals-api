"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("./auth.js");
const config_js_1 = require("./config.js");
const routes_js_1 = require("./routes.js");
(0, config_js_1.assertBridgeConfig)();
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '1mb' }));
app.get('/', (_req, res) => {
    res.json({
        ok: true,
        service: 'alphamentals-mt5-bridge',
        message: 'Bridge online.',
    });
});
app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'alphamentals-mt5-bridge',
        status: 'healthy',
    });
});
app.use(auth_js_1.requireApiKey);
app.use(routes_js_1.bridgeRouter);
app.listen(config_js_1.bridgeConfig.port, '0.0.0.0', () => {
    console.log(`[mt5-bridge] listening on http://0.0.0.0:${config_js_1.bridgeConfig.port}`);
});
