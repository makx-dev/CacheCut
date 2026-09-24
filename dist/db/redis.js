"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
exports.default = testRedis;
const ioredis_1 = require("ioredis");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.redis = new ioredis_1.Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
}); // Create a new Redis client
exports.redis.on('error', (err) => console.log('Redis Client Error', err));
async function testRedis(req, res) {
    try {
        await exports.redis.set('test', 'test');
        const test = await exports.redis.get('test');
        res.json({
            success: true,
            message: 'Redis connection successful',
            data: test,
        });
    }
    catch (error) {
        console.log(error);
        res.json({
            success: false,
            message: 'Redis connection failed',
            data: null,
        });
    }
}
//# sourceMappingURL=redis.js.map