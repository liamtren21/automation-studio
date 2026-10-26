import {it,expect} from 'vitest';
import {createDatabase} from '../packages/db/src/database';
import {rateLimit} from '../apps/web/src/server/automation/rate-limit';
it('bounds a shared resource atomically without storing the raw identifier',async()=>{const db=await createDatabase('memory://');try{await rateLimit(db,'private-key-id',2,100);await rateLimit(db,'private-key-id',2,100);await expect(rateLimit(db,'private-key-id',2,100)).rejects.toThrow(/Too many/);await rateLimit(db,'private-key-id',2,160);expect(JSON.stringify((await db.query('SELECT * FROM studio_rate_limits')).rows)).not.toContain('private-key-id');}finally{await db.close();}});
