import {expect,it} from 'vitest';
import {proposePriorityAllocation} from '../packages/automation/src/studio/allocation';
import type {StudioPolicy} from '../packages/automation/src/studio/types';
const policy=(id:string,priority:string):StudioPolicy=>({chainId:'31611',vault:'0x1111111111111111111111111111111111111111',policyId:`0x${id.repeat(64)}`,version:'1',recipient:'0x3333333333333333333333333333333333333333',amount:'5',startAt:'100',endAt:'999999',intervalSeconds:'86400',perRunCap:'5',perPeriodCap:'5',lifetimeCap:'50',priority,enabled:true});
const first=policy('1','1'),second=policy('2','2');
const account={now:'100',balance:'100',committedBills:'10',buffer:'10',globalBudget:'90',globalSpent:'20',protectionSourceHash:`0x${'4'.repeat(64)}`,protectionExpiresAt:'999999',allocations:{[second.policyId]:'70'},spent:{},consumed:{}};
it('proposes priority targets and explicit releases without changing approved allocations',()=>{
 const before=structuredClone(account),result=proposePriorityAllocation(account,[second,first]);
 expect(result.capacity).toBe('70');expect(result.rules.map(r=>r.proposedTarget)).toEqual(['50','20']);
 expect(result.rules[0].extraDelta).toBe('50');expect(result.rules[1].waitingAmount).toBe('30');
 expect(result.releasesNeeded).toBe('50');expect(result.operations.map(o=>o.kind)).toEqual(['release','allocate']);
 expect(result.operations.every(o=>o.requiresOwnerReview)).toBe(true);expect(result.automatic).toBe(false);expect(account).toEqual(before);
});
it('reserves unknown allocations and honors lifetime spending and explicit demand',()=>{
 const result=proposePriorityAllocation({...account,allocations:{unknown:'40'},spent:{[first.policyId]:'45'}},[second,first],{[second.policyId]:'40'});
 expect(result.reservedForOtherRules).toBe('40');expect(result.rules.map(r=>r.proposedTarget)).toEqual(['5','25']);expect(result.rules[1].waitingAmount).toBe('15');
 expect(result.operations.some(o=>o.policyId==='unknown')).toBe(false);
});
it('handles exhausted caps and rejects malformed or duplicated allocation inputs',()=>{
 expect(proposePriorityAllocation({...account,globalSpent:'100'},[first]).rules[0].status).toBe('waiting');
 expect(()=>proposePriorityAllocation({...account,balance:'01'},[first])).toThrow();
 expect(()=>proposePriorityAllocation(account,[first,first])).toThrow();
 expect(()=>proposePriorityAllocation(account,[first],{[first.policyId]:'-1'})).toThrow();
});
it('preserves inactive reservations and computes large allocations without floating point',()=>{
 const huge='9007199254740993000000000000000001',inactive={...second,enabled:false},a={...account,balance:huge,committedBills:'0',buffer:'0',globalBudget:huge,globalSpent:'0',allocations:{[inactive.policyId]:'1'}};
 const result=proposePriorityAllocation(a,[{...first,lifetimeCap:huge},inactive]);
 expect(result.rules[0].proposedTarget).toBe((BigInt(huge)-1n).toString());expect(result.reservedForOtherRules).toBe('1');
 expect(result.rules[1].status).toBe('inactive');expect(result.rules[1].proposedTarget).toBe('1');expect(result.operations).toHaveLength(1);
});
