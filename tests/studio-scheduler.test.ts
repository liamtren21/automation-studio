import {it,expect} from 'vitest';
import {authorizedScheduler} from '../apps/web/src/server/automation/scheduler-auth';
it('requires a dedicated strong bearer secret without accepting a prefix or cookie',()=>{const key='a'.repeat(64);expect(authorizedScheduler(null,key)).toBe(false);expect(authorizedScheduler('Bearer '+key,key)).toBe(true);expect(authorizedScheduler('Bearer '+key+'a',key)).toBe(false);expect(authorizedScheduler('Bearer '+key,'short')).toBe(false);expect(authorizedScheduler('bearer '+key,key)).toBe(false);});
