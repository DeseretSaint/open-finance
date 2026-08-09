-- 020: version counter for the agent manual (D11) — cheap change detection.
-- The agent passes ?since=<last version it saw> and only receives the manual
-- text when the version has changed, so identical instructions are never
-- re-read (no wasted tokens).
ALTER TABLE agent_manual ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
