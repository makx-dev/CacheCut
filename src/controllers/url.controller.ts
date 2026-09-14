import { Request, Response } from 'express';
import { pool } from '../db/pool';
import { generateCode } from '../utils/generateCode';

export const shortenUrl = async (req: Request, res: Response) => {
  const { og_url } = req.body;           

  //case when url isn't filled
  if (!og_url || typeof og_url !== 'string') {
    return res.status(400).json({ error: 'og_url is required' });
  }

  //error handler for inavlid url
  try {
    new URL(og_url); // throws if invalid
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' }); 
  }

  let short_code = generateCode(); //call generateCode
  let attempts = 0;

   // handle collision (rare with 7-char nanoid, but handle it)
 while (attempts < 5) {
    const existing = await pool.query(
      'SELECT 1 FROM urls WHERE short_code = $1',
      [short_code]
    );
    if (existing.rowCount === 0) break;
    short_code = generateCode();
    attempts++;
  }

  try {
    const result = await pool.query(
      `INSERT INTO urls (short_code, og_url) VALUES ($1, $2) RETURNING short_code, og_url, created_at`,
      [short_code, og_url]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create short URL' });
  }
};

export const redirectUrl = async (req: Request, res: Response) => {
  const { code } = req.params;

  try {
    const result = await pool.query(
      'UPDATE urls SET click_cnt = click_cnt + 1 WHERE short_code = $1 RETURNING og_url',
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    return res.redirect(result.rows[0].og_url);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};



// One gap worth flagging: your :code route will also catch anything that isn't /shorten — including 
// things like /favicon.ico. Not a real problem now, but worth a mental note for when you add more 
// routes later (put more specific paths before the catch-all :code).