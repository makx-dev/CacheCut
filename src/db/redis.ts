import { Redis } from 'ioredis';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

export const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
}); // Create a new Redis client

redis.on('error', (err) => console.log('Redis Client Error', err));

export default async function testRedis(req: express.Request, res: express.Response) {
    try {
        await redis.set('test', 'test');
        const test = await redis.get('test');
        res.json({
            success: true,
            message: 'Redis connection successful',
            data: test,
        });
    } catch (error) {
        console.log(error);
        res.json({
            success: false,
            message: 'Redis connection failed',
            data: null,
        });
    }
}