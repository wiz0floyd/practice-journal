-- user_data: one row per (user, key) storing the full JSON blob for each
-- data type (pj_items_v1, pj_cards_v1, pj_context_v1, and future keys).
-- Conflict resolution is last-write-wins by updated_at — single-user app,
-- true concurrent edits on two devices simultaneously are rare enough that
-- losing one is acceptable.

CREATE TABLE user_data (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own data"
  ON user_data FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_data TO authenticated;
