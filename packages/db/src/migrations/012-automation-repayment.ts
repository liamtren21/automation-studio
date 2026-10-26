export const automationRepayment={version:12,name:'automation-owner-repayment-handoffs',sql:`
CREATE TABLE automation_repayment_handoffs(
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), owner text NOT NULL,
 status text NOT NULL, body jsonb NOT NULL, withdrawal_hash text UNIQUE, repayment_hash text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX automation_repayment_one_unresolved ON automation_repayment_handoffs(workspace_id)
 WHERE status NOT IN ('confirmed','cancelled');
`};
