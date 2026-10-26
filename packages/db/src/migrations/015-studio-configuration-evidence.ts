import type {Migration} from './runner';
export const studioConfigurationEvidence:Migration={version:15,name:'studio-configuration-evidence',sql:`
CREATE TABLE studio_configuration_evidence(workspace_id text NOT NULL REFERENCES workspaces(id),policy_id text NOT NULL,version numeric(78,0) NOT NULL,config_hash text NOT NULL,tx_hash text NOT NULL,block_number numeric(78,0) NOT NULL,block_hash text NOT NULL,effective_at bigint NOT NULL,verified_at bigint NOT NULL,PRIMARY KEY(workspace_id,policy_id,version,tx_hash,block_hash));
`};
