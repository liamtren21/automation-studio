import {expect,it} from 'vitest';
import {savedScenarios} from '../packages/automation/src/studio/scenarios';
it('explains shared budgets, stale protection and revoked permission using the real decision engine',()=>{
 const examples=savedScenarios();expect(examples).toHaveLength(3);
 expect(examples[0]!.outcomes.map(o=>o.reason)).toEqual(['ALLOWED','ALLOCATION_CAP']);
 expect(examples[1]!.outcomes[0]!.reason).toBe('PROTECTION_STALE');
 expect(examples[2]!.outcomes[0]!.reason).toBe('INACTIVE');
 expect(examples.every(s=>s.mode==='simulated'&&s.action)).toBe(true);
 expect(savedScenarios()).toEqual(examples);
});
