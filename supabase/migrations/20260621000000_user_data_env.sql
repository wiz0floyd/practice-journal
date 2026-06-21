-- Segregate user_data by environment so dev writes never touch prod rows.
-- Existing rows get DEFAULT 'prod', which correctly identifies them as production data.
ALTER TABLE user_data ADD COLUMN env TEXT NOT NULL DEFAULT 'prod';

ALTER TABLE user_data DROP CONSTRAINT user_data_pkey;
ALTER TABLE user_data ADD PRIMARY KEY (user_id, env, key);
