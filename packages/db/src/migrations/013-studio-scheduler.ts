import type {Migration} from './runner';
export const automationScheduler:Migration={version:13,name:'studio-scheduler-heartbeat',sql:`
CREATE TABLE studio_scheduler(id text PRIMARY KEY,last_started bigint,last_finished bigint,status text NOT NULL DEFAULT 'not_configured',body jsonb NOT NULL DEFAULT '{}');
INSERT INTO studio_scheduler(id) VALUES('main');
`};
