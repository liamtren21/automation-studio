import {it,expect} from 'vitest';
import {forecastPortfolio} from '../packages/automation/src/studio/portfolio';
import type {StudioPolicy} from '../packages/automation/src/studio';
const a:StudioPolicy={chainId:'31611',vault:'0x1111111111111111111111111111111111111111',policyId:'0x'+'22'.repeat(32) as `0x${string}`,version:'1',recipient:'0x3333333333333333333333333333333333333333',amount:'5',startAt:'100',endAt:'3000000',intervalSeconds:'86400',perRunCap:'5',perPeriodCap:'5',lifetimeCap:'30',priority:'1',enabled:true};
const account={now:'100',balance:'50',committedBills:'10',buffer:'10',globalBudget:'30',globalSpent:'0',protectionSourceHash:'0x'+'44'.repeat(32),protectionExpiresAt:'3000000',allocations:{[a.policyId]:'10',['0x'+'55'.repeat(32)]:'20'},spent:{},consumed:{}};
it('forecasts all rules against one shared balance while preserving allocations and floor',()=>{
 const b={...a,policyId:'0x'+'55'.repeat(32) as `0x${string}`,priority:'2'};
 const rows=forecastPortfolio(account,[b,a],30);
 expect(rows).toHaveLength(30);expect(rows.at(-1)?.balance).toBe('20');
 expect(rows[0].paid).toBe('10');expect(rows[1].paid).toBe('10');expect(rows[2].paid).toBe('5');
 expect(rows.at(-1)?.blocked).toBeGreaterThan(0);
});
it('shows expense scenarios separately without treating expected receipts as spendable',()=>{
 const rows=forecastPortfolio({...account,allocations:{[a.policyId]:'30'}},[a],30,{extraExpense:'31',expenseDay:0});
 expect(rows[0].paid).toBe('0');expect(rows[0].balance).toBe('19');expect(rows[0].belowFloor).toBe(true);
});
it('keeps expected income out of execution while showing on-time and delayed closing cash',()=>{
 const rows=forecastPortfolio({...account,balance:'20',allocations:{[a.policyId]:'30'}},[a],3,{expectedIncome:'100',incomeDay:0,incomeDelayDays:2,repaymentExpense:'3',repaymentDay:1});
 expect(rows.map(r=>r.paid)).toEqual(['0','0','0']);
 expect(rows.map(r=>r.balance)).toEqual(['20','17','17']);
 expect(rows.map(r=>r.hypotheticalBalance)).toEqual(['120','117','117']);
 expect(rows.map(r=>r.delayedIncomeBalance)).toEqual(['20','17','117']);
 expect(account.balance).toBe('50');
});
it('retains hypothetical expense deficits and bounds scenario dates and canonical money',()=>{
 const rows=forecastPortfolio({...account,balance:'2'},[],2,{repaymentExpense:'5',repaymentDay:0,expectedIncome:'7',incomeDay:1,incomeDelayDays:90});
 expect(rows[0].balance).toBe('0');expect(rows[0].hypotheticalBalance).toBe('-3');expect(rows[1].hypotheticalBalance).toBe('4');expect(rows[1].delayedIncomeBalance).toBe('-3');
 expect(()=>forecastPortfolio(account,[],2,{expectedIncome:'01'})).toThrow();
 expect(()=>forecastPortfolio(account,[],2,{incomeDay:2})).toThrow();
 expect(()=>forecastPortfolio(account,[],2,{incomeDelayDays:91})).toThrow();
});
it('preserves input state and ignores income beyond the horizon exactly in base units',()=>{
 const input={...account,balance:'9007199254740993000000000000000001'},before=structuredClone(input);
 const rows=forecastPortfolio(input,[],2,{expectedIncome:'9007199254740993000000000000000001',incomeDay:1,incomeDelayDays:1});
 expect(rows[1].hypotheticalBalance).toBe('18014398509481986000000000000000002');expect(rows[1].delayedIncomeBalance).toBe(input.balance);expect(input).toEqual(before);
});
