import type {Migration} from './runner';
export const automationAccounts:Migration={version:9,name:'automation-accounts',sql:`
CREATE TABLE automation_accounts(workspace_id text PRIMARY KEY REFERENCES workspaces(id),mode text NOT NULL CHECK(mode IN ('demo','live')),chain_id numeric(78,0) NOT NULL,vault text NOT NULL,body jsonb NOT NULL,UNIQUE(chain_id,vault));
ALTER TABLE automation_policies ADD COLUMN display_name text NOT NULL DEFAULT 'Scheduled payment';
`};
