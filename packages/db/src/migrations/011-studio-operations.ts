import type {Migration} from './runner';
export const automationOperations:Migration={version:11,name:'studio-operations',sql:`
CREATE TABLE studio_obligations(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),name text NOT NULL,amount numeric(78,0) NOT NULL CHECK(amount>0),due_date text NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','settled')),revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX studio_obligations_workspace ON studio_obligations(workspace_id);
CREATE TABLE studio_expected_income(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),name text NOT NULL,amount numeric(78,0) NOT NULL CHECK(amount>0),due_date text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE studio_trove_watches(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),borrower text NOT NULL,threshold_bps integer NOT NULL CHECK(threshold_bps BETWEEN 11000 AND 1000000),interval_seconds integer NOT NULL CHECK(interval_seconds BETWEEN 60 AND 86400),active boolean NOT NULL DEFAULT true,next_due bigint NOT NULL,last_checked bigint,last_result jsonb,last_error text,state text NOT NULL DEFAULT 'unseen',revision integer NOT NULL DEFAULT 1,lease_token text,lease_until bigint NOT NULL DEFAULT 0,UNIQUE(workspace_id,borrower));
CREATE INDEX studio_trove_watches_due ON studio_trove_watches(active,next_due);
CREATE TABLE studio_operation_notifications(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),watch_id text NOT NULL REFERENCES studio_trove_watches(id),episode text NOT NULL,state text NOT NULL,message text NOT NULL,action_path text NOT NULL,created_at bigint NOT NULL,UNIQUE(watch_id,episode));
CREATE TABLE studio_monitor_heartbeat(id text PRIMARY KEY,at bigint NOT NULL,checked integer NOT NULL,errors integer NOT NULL);
`};
