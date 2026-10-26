import type {Migration} from './runner';
export const studioMonitorState:Migration={version:16,name:'studio-monitor-state',sql:`
ALTER TABLE studio_trove_watches ADD COLUMN recovery_bps integer;
UPDATE studio_trove_watches SET recovery_bps=threshold_bps+500;
ALTER TABLE studio_trove_watches ALTER COLUMN recovery_bps SET NOT NULL;
ALTER TABLE studio_trove_watches ADD CONSTRAINT watch_recovery_above_entry CHECK(recovery_bps>threshold_bps AND recovery_bps<=1000500);
ALTER TABLE studio_trove_watches ADD COLUMN cooldown_seconds integer NOT NULL DEFAULT 600 CHECK(cooldown_seconds BETWEEN 60 AND 86400);
ALTER TABLE studio_trove_watches ADD COLUMN alert_state text NOT NULL DEFAULT 'unseen';
ALTER TABLE studio_trove_watches ADD COLUMN last_notified_state text;
ALTER TABLE studio_trove_watches ADD COLUMN last_notified_at bigint;
ALTER TABLE studio_trove_watches ADD COLUMN last_error_notified_at bigint;
`};
