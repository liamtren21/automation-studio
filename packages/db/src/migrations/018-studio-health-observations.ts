import type {Migration} from './runner';
export const studioHealthObservations:Migration={version:18,name:'studio-health-observations',sql:`
ALTER TABLE studio_trove_watches ADD COLUMN IF NOT EXISTS last_error_notified_at bigint;
ALTER TABLE studio_trove_watches ADD COLUMN IF NOT EXISTS last_success_at bigint;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS last_webhook_key text;
`};
