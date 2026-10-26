import type {Migration} from './runner';
export const automationRecovery:Migration={version:10,name:'automation-executor-recovery',sql:`
ALTER TABLE automation_executor_nonces DROP CONSTRAINT automation_executor_nonces_state_check;
ALTER TABLE automation_executor_nonces ADD CONSTRAINT automation_executor_nonces_state_check CHECK(state IN ('unresolved','settled','released'));
CREATE TABLE automation_executor_quarantines(chain_id numeric(78,0) NOT NULL,executor text NOT NULL,run_id text NOT NULL,reason text NOT NULL,resolved boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(chain_id,executor,run_id));
`};
