import {afterEach,expect,it} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {runMigrations} from '../packages/db/src/migrations/runner';
const open:Database[]=[];afterEach(async()=>{await Promise.all(open.splice(0).map(d=>d.close()));});
it('creates only Studio schema, with no bills, treasury bindings or repayment tables',async()=>{
 const db=await createDatabase('memory://');open.push(db);
 const tables=(await db.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(r=>r.table_name);
 expect(tables).toContain('automation_cash_protection');expect(tables).toContain('automation_accounts');
 for(const name of ['bills','treasury_bindings','repayments','workspace_members'])expect(tables).not.toContain(name);
});
it('refuses an existing Mezora schema before applying any Studio migration',async()=>{
 const db=await createDatabase('memory://');open.push(db);
 await db.query("UPDATE schema_migrations SET name='original-treasury-schema' WHERE version=0");
 await expect(runMigrations(db)).rejects.toThrow('Migration 0 does not match');
 expect((await db.query<{name:string}>('SELECT name FROM schema_migrations WHERE version=0')).rows[0].name).toBe('original-treasury-schema');
});
