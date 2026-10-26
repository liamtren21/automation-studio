import {describe,it,expect} from 'vitest';
import {createBatchDraft,validateBatchDraft,buildBatchPolicy,localDateTimeToSeconds,batchDraftStorageKey,type BatchInput} from '../packages/automation/src/studio/batch';
import {validateV2Policy} from '../packages/mezo/src/automation-v2-adapter';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BatchPayment} from '../apps/web/src/features/automation/batch-payment';
const a='0x1111111111111111111111111111111111111111',b='0x2222222222222222222222222222222222222222';
const input:BatchInput={name:'Team payments',recipients:[{address:a,amount:'0.01'},{address:b,amount:'0.02'}],schedule:{kind:'daily',startAt:'1793000000',endAt:'1793172800'},lifetimeBudget:'0.09'};
describe('unsigned batch payment drafts',()=>{
 it('shows a usable draft form without an activation button or technical policy fields',()=>{
  const html=renderToStaticMarkup(createElement(BatchPayment,{mode:'live',owner:a}));
  expect(html).toContain('Pay a group');expect(html).toContain('Recipient 1');expect(html).toContain('Recipient 2');expect(html).toContain('not ready yet');expect(html).toContain('Review group payment');
  expect(html).not.toMatch(/Activate|Policy hash|Policy ID|chainId|eth_sendTransaction/);
  expect(renderToStaticMarkup(createElement(BatchPayment,{mode:'demo'}))).toContain('No wallet request or real payment');
 });
 it('converts exact decimal amounts and uses the complete batch as the per-run cap',()=>{
  const draft=createBatchDraft(input);expect(draft.totalPerBatch).toBe('30000000000000000');expect(draft.lifetimeBudget).toBe('90000000000000000');expect(draft.enabled).toBe(false);
  expect(validateBatchDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  const built=buildBatchPolicy(draft,{id:'0x'+'12'.repeat(32) as `0x${string}`});
  expect(built.policy.kind).toBe(0);expect(built.policy.enabled).toBe(false);expect(built.policy.runCap).toBe(30000000000000000n);expect(built.policy.periodCap).toBe(built.policy.runCap);
  expect(()=>validateV2Policy(built.policy,built.payees,built.values)).not.toThrow();
 });
 it('rejects duplicate, zero and invalid recipients and a batch outside 2..20 people',()=>{
  for(const recipients of [[input.recipients[0]!],[...input.recipients,...input.recipients],Array.from({length:21},(_,i)=>({address:'0x'+(i+1).toString(16).padStart(40,'0'),amount:'0.01'})),[{address:a,amount:'0.01'},{address:'0x'+'0'.repeat(40),amount:'0.01'}]])expect(()=>createBatchDraft({...input,recipients})).toThrow();
  expect(()=>createBatchDraft({...input,recipients:[{address:a,amount:'0.01'},{address:'wrong',amount:'0.01'}]})).toThrow();
 });
 it('rejects fractional truncation, exponent notation, negatives, zero and insufficient lifetime budget',()=>{
  for(const amount of ['0','-1','1e3','0.0000000000000000001','1.','01.2'])expect(()=>createBatchDraft({...input,recipients:[{address:a,amount},{address:b,amount:'0.01'}]})).toThrow();
  expect(()=>createBatchDraft({...input,lifetimeBudget:'0.02'})).toThrow(/whole batch/i);
 });
 it('rejects overflow of a single amount or the aggregate',()=>{
  const large=((2n**256n-1n)/10n**18n).toString();
  expect(()=>createBatchDraft({...input,recipients:[{address:a,amount:large},{address:b,amount:large}],lifetimeBudget:large})).toThrow();
  expect(()=>createBatchDraft({...input,lifetimeBudget:(2n**256n).toString()})).toThrow();
  expect(()=>createBatchDraft({...input,schedule:{kind:'daily',startAt:'1',endAt:(2n**256n-1n).toString()}})).toThrow();
 });
 it('requires valid schedules and prevents tampered totals, live enabled drafts and self payees',()=>{
  for(const schedule of [{kind:'daily' as const,startAt:'10',endAt:'10'},{kind:'once' as const,startAt:'10',endAt:'20'},{kind:'weekly' as const,startAt:'1.2',endAt:'999'}])expect(()=>createBatchDraft({...input,schedule})).toThrow();
  const draft=createBatchDraft(input);
  expect(()=>validateBatchDraft({...draft,totalPerBatch:'1'})).toThrow();expect(()=>validateBatchDraft({...draft,enabled:true})).toThrow();
  expect(()=>buildBatchPolicy(draft,{id:'0x'+'12'.repeat(32) as `0x${string}`,account:a})).toThrow(/account/i);
 });
 it('creates a one-time 24-hour window and keeps local storage scoped to mode and owner',()=>{
  const draft=createBatchDraft({...input,schedule:{kind:'once',startAt:'100',endAt:'86500'}});expect(draft.schedule.intervalSeconds).toBe('86400');
  expect(batchDraftStorageKey('demo',a)).not.toBe(batchDraftStorageKey('live',a));expect(batchDraftStorageKey('live',a)).not.toBe(batchDraftStorageKey('live',b));
  const expected=new Date(2026,9,27,9,30).getTime()/1000;expect(localDateTimeToSeconds('2026-10-27T09:30')).toBe(String(expected));expect(()=>localDateTimeToSeconds('2026-02-31T09:30')).toThrow();
 });
});
