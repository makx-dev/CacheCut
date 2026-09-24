"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redirectUrl = exports.shortenUrl = exports.getUrl = void 0;
const pool_1 = require("../db/pool");
const generateCode_1 = require("../utils/generateCode");
const redis_1 = require("../db/redis");
const getUrl = async (req, res) => {
    const { code } = req.params;
    try {
        const cached = await redis_1.redis.get(`url:${code}`);
        if (cached)
            return res.json(JSON.parse(cached));
        const result = await pool_1.pool.query('SELECT * FROM urls WHERE short_code = $1', [code]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Short URL not found' });
        }
        await redis_1.redis.set(`url:${code}`, JSON.stringify(result.rows[0]), 'EX', 3600);
        return res.json(result.rows[0]);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to get short URL' });
    }
};
exports.getUrl = getUrl;
const shortenUrl = async (req, res) => {
    const { og_url } = req.body;
    //case when url isn't filled
    if (!og_url || typeof og_url !== 'string') {
        return res.status(400).json({ error: 'og_url is required' });
    }
    //error handler for inavlid url
    try {
        new URL(og_url); // throws if invalid
    }
    catch {
        return res.status(400).json({ error: 'Invalid URL format' });
    }
    let short_code = (0, generateCode_1.generateCode)(); //call generateCode
    let attempts = 0;
    // handle collision (rare with 7-char nanoid, but handle it)
    while (attempts < 5) {
        const existing = await pool_1.pool.query('SELECT 1 FROM urls WHERE short_code = $1', [short_code]);
        if (existing.rowCount === 0)
            break;
        short_code = (0, generateCode_1.generateCode)();
        attempts++;
    }
    try {
        const result = await pool_1.pool.query(`INSERT INTO urls (short_code, og_url) VALUES ($1, $2) RETURNING short_code, og_url, created_at`, [short_code, og_url]);
        return res.status(201).json(result.rows[0]);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create short URL' });
    }
};
exports.shortenUrl = shortenUrl;
const redirectUrl = async (req, res) => {
    const { code } = req.params;
    const cached = await redis_1.redis.get(`url:${code}`);
    if (cached) {
        const { og_url } = JSON.parse(cached);
        await redis_1.redis.incr(`clicks:${code}`); //flush to postgres in batches later
        return res.redirect(og_url);
    }
    else {
        const result = await pool_1.pool.query('SELECT og_url FROM urls WHERE short_code = $1', [code]);
        console.log('CACHE MISS');
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Short URL not found' });
        }
    }
    try {
        const result = await pool_1.pool.query('UPDATE urls SET click_cnt = click_cnt + 1 WHERE short_code = $1 RETURNING og_url', [code]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Short URL not found' });
        }
        return res.redirect(result.rows[0].og_url);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to redirect' });
    }
};
exports.redirectUrl = redirectUrl;
// One gap worth flagging: your :code route will also catch anything that isn't /shorten — including
// things like /favicon.ico. Not a real problem now, but worth a mental note for when you add more
// routes later (put more specific paths before the catch-all :code).
//# sourceMappingURL=url.controller.js.map