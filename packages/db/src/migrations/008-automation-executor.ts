import type {Migration} from './runner';
export const executorNonceMigration:Migration={version:8,name:'automation-executor-nonce',sql:`
CREATE TABLE automation_executor_nonces(
 chain_id numeric(78,0) NOT NULL CHECK(chain_id>0),
 executor text NOT NULL CHECK(executor=lower(executor)),
 run_id text NOT NULL,
 intent_hash text NOT NULL,
 fencing_token numeric(78,0) NOT NULL CHECK(fencing_token>0),
 nonce numeric(78,0) NOT NULL CHECK(nonce>=0),
 state text NOT NULL CHECK(state IN ('unresolved','settled')),
 PRIMARY KEY(chain_id,executor)
);
`};
