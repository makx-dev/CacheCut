CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  user_name VARCHAR(100) NOT NULL
);

CREATE TABLE urls (
  url_id SERIAL PRIMARY KEY,
  short_code VARCHAR(10) UNIQUE NOT NULL,
  og_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  click_cnt INTEGER DEFAULT 0,
  user_id INTEGER REFERENCES users(user_id)
);