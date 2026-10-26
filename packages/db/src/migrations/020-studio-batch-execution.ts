import type {Migration} from './runner';
export const studioBatchExecution:Migration={version:20,name:'studio-batch-execution',sql:`
CREATE TABLE studio_batch_policies (
 workspace_id text NOT NULL REFERENCES workspaces(id),
 draft_id text NOT NULL REFERENCES studio_batch_drafts(id),
 account text NOT NULL CHECK(account=lower(account)),
 policy_id text NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK(version=1),
 config_hash text NOT NULL,
 body jsonb NOT NULL,
 status text NOT NULL DEFAULT 'setup' CHECK(status IN ('setup','active','stopped')),
 PRIMARY KEY(workspace_id,draft_id), UNIQUE(account,policy_id,version)
);
CREATE FUNCTION studio_batch_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.account IS DISTINCT FROM OLD.account OR NEW.policy_id IS DISTINCT FROM OLD.policy_id OR NEW.version IS DISTINCT FROM OLD.version OR NEW.config_hash IS DISTINCT FROM OLD.config_hash OR NEW.body IS DISTINCT FROM OLD.body THEN RAISE EXCEPTION 'Group payment approvals are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER studio_batch_policy_guard BEFORE UPDATE ON studio_batch_policies FOR EACH ROW EXECUTE FUNCTION studio_batch_policy_immutable();
CREATE TABLE studio_batch_runs (
 id text PRIMARY KEY,
 workspace_id text NOT NULL,
 draft_id text NOT NULL,
 version bigint NOT NULL CHECK(version=1),
 period_index numeric(78,0) NOT NULL CHECK(period_index>=0),
 state text NOT NULL DEFAULT 'claimed',
 body jsonb NOT NULL DEFAULT '{}'::jsonb,
 worker_id text NOT NULL,
 lease_until bigint NOT NULL,
 fencing_token bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,draft_id,version,period_index),
 FOREIGN KEY(workspace_id,draft_id) REFERENCES studio_batch_policies(workspace_id,draft_id)
);
CREATE INDEX studio_batch_runs_state ON studio_batch_runs(state,lease_until);
CREATE TABLE studio_batch_reviews (
 id text PRIMARY KEY,
 workspace_id text NOT NULL,
 draft_id text NOT NULL,
 body jsonb NOT NULL,
 tx_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,draft_id) REFERENCES studio_batch_policies(workspace_id,draft_id)
);
`};
