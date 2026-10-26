import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { runMigrations } from "./migrations/runner";
export interface Sql { query<T = Record<string,unknown>>(sql:string, params?:unknown[]):Promise<{rows:T[]}>; exec?(sql:string):Promise<unknown> }
export interface Database extends Sql { transaction<T>(fn:(sql:Sql)=>Promise<T>):Promise<T>;close():Promise<void> }
export async function createDatabase(url?:string):Promise<Database>{
 if((process.env.VERCEL||process.env.NODE_ENV==="production")&&!url?.startsWith("postgres"))throw new Error("Hosted Automation Studio requires a dedicated PostgreSQL DATABASE_URL. Local PGlite cannot provide durable serverless storage.");
 if(url?.startsWith("postgres")){
  const pool=new pg.Pool({connectionString:url,max:5});
  const query:Sql["query"]=async(sql,params)=>{const r=await pool.query(sql,params);return {rows:r.rows}};
  const db:Database={query,close:()=>pool.end(),async transaction(fn){const c=await pool.connect();try{await c.query("BEGIN");const out=await fn({query:async(s,p)=>({rows:(await c.query(s,p)).rows})});await c.query("COMMIT");return out;}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}};
  try{await runMigrations(db,{postgres:true});return db;}catch(error){await db.close();throw error;}
 }
 const dir=url==="memory://"?undefined:url||path.resolve(/*turbopackIgnore: true*/ process.env.STUDIO_DATA_DIR||path.join(process.cwd(),".data","automation-studio"));
 if(dir)await mkdir(dir,{recursive:true});
 const p=new PGlite(dir);
 const query:Sql["query"]=async(sql,params)=>({rows:(await p.query(sql,params)).rows as never[]});
 const db:Database={query,exec:s=>p.exec(s),close:()=>p.close(),transaction:fn=>p.transaction(tx=>fn({query:async(s,a)=>({rows:(await tx.query(s,a)).rows as never[]}),exec:s=>tx.exec(s)}))};
 try{await runMigrations(db);return db;}catch(error){await db.close();throw error;}
}
const globalDb=globalThis as typeof globalThis & {studioDb?:Promise<Database>};
export const database=()=>globalDb.studioDb??=(createDatabase(process.env.DATABASE_URL));
