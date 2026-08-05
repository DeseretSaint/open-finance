-- 016: Hermes tokens may explicitly follow current Agent settings.
-- Scope enforcement already intersects token scopes with current caps on every request;
-- this flag documents and exposes that behavior for the dedicated Hermes connection.
ALTER TABLE agent_tokens ADD COLUMN follow_settings INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_agent_tokens_follow_settings ON agent_tokens(user_id, follow_settings);
