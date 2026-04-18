-- Migration: bucky_earnings table
-- Tracks node earnings in the mesh marketplace

CREATE TABLE IF NOT EXISTS bucky_earnings (
  node_id TEXT PRIMARY KEY,
  credits NUMERIC DEFAULT 0,
  sats BIGINT DEFAULT 0,
  jobs_served INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS bucky_earnings_updated_idx ON bucky_earnings(updated_at DESC);
