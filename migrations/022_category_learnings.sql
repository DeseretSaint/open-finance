-- 022: per-user learned merchant → category mappings.
-- When the user manually sets a category on a transaction, we remember the
-- (normalized) merchant name → category so future repeat charges from the same
-- merchant are auto-suggested. This is the highest-priority local signal
-- (above the global NAME_KEYWORDS fallback) but still below an explicit Plaid
-- category path, so a user's override of a mis-categorized recurring charge
-- sticks for that merchant.
CREATE TABLE category_learnings (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_key TEXT NOT NULL,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  count        INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, merchant_key)
);
CREATE INDEX idx_category_learnings_user ON category_learnings(user_id);
