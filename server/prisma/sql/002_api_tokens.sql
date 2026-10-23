-- Personal access tokens (for the Peblo MCP server and scripts). Only a hash of each token is stored.
CREATE TABLE api_tokens (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    prefix TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP(3) NULL,
    CONSTRAINT api_tokens_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX api_tokens_token_hash_key ON api_tokens(token_hash);
CREATE INDEX api_tokens_user_id_idx ON api_tokens(user_id);
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
