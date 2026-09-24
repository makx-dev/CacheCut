"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const url_routes_1 = __importDefault(require("./routes/url.routes"));
const clickSync_service_1 = require("./services/clickSync.service");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.disable('x-powered-by');
app.disable('etag');
app.use(express_1.default.json());
app.use('/', url_routes_1.default);
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    (0, clickSync_service_1.startClickSyncWorker)(1000, 5000);
});
//# sourceMappingURL=index.js.map