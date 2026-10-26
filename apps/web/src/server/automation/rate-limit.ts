import {createHash} from 'node:crypto';
import type {Sql} from '../../../../../packages/db/src/database';
export async function rateLimit(db:Sql,key:string,limit:number,now=Math.floor(Date.now()/1000)){
 const digest=createHash('sha256').update(key).digest('hex'),bucket=Math.floor(now/60);
 const row=(await db.query<{count:number}>('INSERT INTO studio_rate_limits(bucket_key,bucket) VALUES($1,$2) ON CONFLICT(bucket_key,bucket) DO UPDATE SET count=studio_rate_limits.count+1 RETURNING count',[digest,bucket])).rows[0];
 if(!row||row.count>limit)throw Object.assign(new Error('Too many requests. Try again in a minute.'),{status:429});
 if(row.count===1)await db.query('DELETE FROM studio_rate_limits WHERE bucket<$1',[bucket-1440]);
}
