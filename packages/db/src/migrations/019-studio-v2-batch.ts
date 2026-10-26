import type {Migration} from './runner';
export const studioV2Batch:Migration={version:19,name:'studio-v2-batch',sql:`
CREATE TABLE studio_v2_accounts (
 workspace_id text PRIMARY KEY REFERENCES workspaces(id),
 address text NOT NULL UNIQUE,
 owner text NOT NULL,
 global_budget numeric(78,0) NOT NULL CHECK(global_budget>0),
 tx_hash text NOT NULL,
 block_number bigint NOT NULL,
 body jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE studio_batch_drafts (
 id text PRIMARY KEY,
 workspace_id text NOT NULL REFERENCES workspaces(id),
 body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_batch_drafts_workspace ON studio_batch_drafts(workspace_id,created_at);
`};
