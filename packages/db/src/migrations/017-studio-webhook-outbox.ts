import type {Migration} from './runner';
export const studioWebhookOutbox:Migration={version:17,name:'studio-webhook-outbox',sql:`
ALTER TABLE automation_runs ADD COLUMN event_version integer NOT NULL DEFAULT 0;
ALTER TABLE automation_runs ADD COLUMN last_webhook_key text;
CREATE TABLE studio_webhook_endpoints(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),url text NOT NULL,secret_encrypted text NOT NULL,enabled boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX studio_webhook_endpoints_workspace ON studio_webhook_endpoints(workspace_id);
CREATE TABLE studio_webhook_outbox(id text PRIMARY KEY,event_id text NOT NULL,endpoint_id text NOT NULL REFERENCES studio_webhook_endpoints(id),endpoint_revision integer NOT NULL,workspace_id text NOT NULL REFERENCES workspaces(id),payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','delivering','delivered','failed','cancelled')),attempts integer NOT NULL DEFAULT 0,next_due bigint NOT NULL,lease_token text,lease_until bigint NOT NULL DEFAULT 0,last_status integer,last_error text,UNIQUE(event_id,endpoint_id));
CREATE INDEX studio_webhook_due ON studio_webhook_outbox(status,next_due);
CREATE TABLE studio_webhook_deliveries(id text PRIMARY KEY,outbox_id text NOT NULL REFERENCES studio_webhook_outbox(id),attempt integer NOT NULL,status integer,error text,at bigint NOT NULL);
`};
