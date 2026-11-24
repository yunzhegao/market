CREATE TABLE IF NOT EXISTS portfolio_book (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  draft_json TEXT,
  public_json TEXT,
  updated_at TEXT,
  published_at TEXT
);
--> statement-breakpoint
INSERT OR IGNORE INTO portfolio_book (id) VALUES (1);
