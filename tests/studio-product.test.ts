import {it,expect} from 'vitest';
import {runtimeState,repaymentProposal} from '../packages/automation/src/studio/product';
it('never equates an approved rule with a running service and rejects future/stale heartbeats',()=>{
 expect(runtimeState('demo')).toBe('simulation');expect(runtimeState('live')).toBe('not_configured');expect(runtimeState('live',{at:'999'},1000)).toBe('online');expect(runtimeState('live',{at:'879'},1000)).toBe('offline');expect(runtimeState('live',{at:'1001'},1000)).toBe('offline');
});
it('caps repayment proposal at protocol debt floor and distinguishes wallet funds from vault surplus',()=>{
 expect(repaymentProposal({debt:'2100',minimumDebt:'1800',gasCompensation:'200',walletBalance:'20',treasurySurplus:'90'})).toEqual({maximumPartialRepayment:'100',fromWallet:'20',surplusForSeparateWithdrawal:'90',automatic:false});
 expect(repaymentProposal({debt:'1900',minimumDebt:'1800',gasCompensation:'200',walletBalance:'100',treasurySurplus:'100'}).maximumPartialRepayment).toBe('0');
});
import {publicPolicyExport} from '../packages/automation/src/studio/product';
import {keccak256,toHex} from 'viem';
it('exports only signed public policy fields and excludes arbitrary metadata or secrets',()=>{
 const policy={chainId:'31611',vault:'0x1111111111111111111111111111111111111111' as const,policyId:keccak256(toHex('export')),version:'1',recipient:'0x2222222222222222222222222222222222222222' as const,amount:'5',startAt:'100',endAt:'200',intervalSeconds:'10',perRunCap:'5',perPeriodCap:'5',lifetimeCap:'30',priority:'1',enabled:true,privateKey:'never-export',session:'private'};
 const result=publicPolicyExport(policy);expect(result.policy).not.toHaveProperty('privateKey');expect(result.policy).not.toHaveProperty('session');expect(result.policyHash).toMatch(/^0x[0-9a-f]{64}$/);
});
