import {studioRateLimits} from './014-studio-rate-limits';
import {studioMonitorState} from './016-studio-monitor-state';
import {studioWebhookOutbox} from './017-studio-webhook-outbox';
import {studioConfigurationEvidence} from './015-studio-configuration-evidence';
import {studioHealthObservations} from './018-studio-health-observations';
import {studioV2Batch} from './019-studio-v2-batch';
import {studioBatchExecution} from './020-studio-batch-execution';
import {automationOperations} from './011-studio-operations';
import {automationRepayment} from './012-automation-repayment';
import {automationScheduler} from './013-studio-scheduler';
import type { Database } from "../database";
import {executorNonceMigration} from './008-automation-executor';
import {automationAccounts} from './009-automation-accounts';
import {automationRecovery} from './010-automation-recovery';
import {automationStudio} from './007-automation-studio';
export interface Migration { version:number; name:string; sql:string }
const baseline: Migration = {version:0,name:"automation-studio-baseline",sql:`
CREATE TABLE workspaces(id text PRIMARY KEY,mode text NOT NULL,balance numeric(78,0) NOT NULL DEFAULT 0,buffer numeric(78,0) NOT NULL DEFAULT 0);
CREATE TABLE challenges(id text PRIMARY KEY,address text NOT NULL,message text NOT NULL,expires_at bigint NOT NULL,used boolean NOT NULL DEFAULT false);
CREATE TABLE sessions(id text PRIMARY KEY,address text NOT NULL,expires_at bigint NOT NULL);
CREATE TABLE automation_cash_protection(workspace_id text PRIMARY KEY REFERENCES workspaces(id),committed_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK(committed_amount>=0),cushion_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK(cushion_amount>=0),updated_at timestamptz NOT NULL DEFAULT now());
`};
export const migrations:readonly Migration[]=[baseline,automationStudio,executorNonceMigration,automationAccounts,automationRecovery,automationOperations,automationRepayment,automationScheduler,studioRateLimits,studioConfigurationEvidence,studioMonitorState,studioWebhookOutbox,studioHealthObservations,studioV2Batch,studioBatchExecution];

export async function runMigrations(db:Database, options:{postgres?:boolean;migrations?:readonly Migration[]}={}) {
 const pending = options.migrations ?? migrations;
 const versions = new Set<number>();
 for(const migration of pending) {
  if(!Number.isSafeInteger(migration.version)||migration.version<0||versions.has(migration.version))throw new Error("Invalid or duplicate migration version.");
  versions.add(migration.version);
 }
 await db.transaction(async q=>{
  // PostgreSQL locks before registry creation so concurrent cold starts cannot race DDL.
  if(options.postgres)await q.query("SELECT pg_advisory_xact_lock(73498121)");
  await q.query("CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
  const applied=new Map((await q.query<{version:number;name:string}>("SELECT version,name FROM schema_migrations")).rows.map(row=>[row.version,row.name]));
  for(const migration of [...pending].sort((a,b)=>a.version-b.version)) {
   const recorded=applied.get(migration.version);
   if(recorded!==undefined) {
    if(recorded!==migration.name)throw new Error(`Migration ${migration.version} does not match the recorded migration.`);
    continue;
   }
   // PGlite needs exec for scripts; pg query uses its simple-query protocol here.
   if(q.exec)await q.exec(migration.sql);else await q.query(migration.sql);
   await q.query("INSERT INTO schema_migrations(version,name) VALUES($1,$2)",[migration.version,migration.name]);
  }
 });
}
