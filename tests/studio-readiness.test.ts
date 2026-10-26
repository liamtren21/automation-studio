import {expect,it} from 'vitest';
import {setupReadiness,paymentGuidance,nextPaymentWindow,policyChanges} from '../packages/automation/src/studio/readiness';
const account={mode:'live' as const,balance:'30',committedBills:'10',buffer:'10',now:'1000',protectionExpiresAt:'1100',protectionSourceHash:'0xaa',worker:{at:'999',executor:'0xabc'}};
it('does not infer executor permission, gas or RPC from a recent heartbeat',()=>{
 const result=setupReadiness({mode:'live',owner:'0xabc',account,source:{sourceHash:'0xaa'}},1000);
 expect(result.find(c=>c.id==='executor')?.state).toBe('unknown');
 expect(result.find(c=>c.id==='gas')?.state).toBe('unknown');
 expect(result.find(c=>c.id==='network')?.state).toBe('unknown');
 expect(result.find(c=>c.id==='service')?.state).toBe('ready');
});
it('rejects mismatched protection, stale and future heartbeats, absent account',()=>{
 expect(setupReadiness({mode:'live',account,source:{sourceHash:'0xbb'}},1000).find(c=>c.id==='protection')?.state).toBe('action_required');
 for(const at of ['879','1001'])expect(setupReadiness({mode:'live',account:{...account,worker:{at,executor:'x'}}},1000).find(c=>c.id==='service')?.state).toBe('action_required');
 expect(setupReadiness({mode:'live',account:null},1000).find(c=>c.id==='account')?.state).toBe('action_required');
 expect(setupReadiness({mode:'live',account},1000).find(c=>c.id==='protection')?.state).toBe('unknown');
});
it('keeps execution unknown without current independently observed wallet chain and account owner',()=>{
 expect(setupReadiness({mode:'live',owner:'0xabc',account},1000).find(c=>c.id==='wallet')?.state).toBe('unknown');
});
it('blocks a session whose owner differs from the loaded automation account',()=>{
 const checks=setupReadiness({mode:'live',owner:'0xaaa',account:{...account,owner:'0xbbb'}},1000);
 expect(checks.find(c=>c.id==='wallet')?.state).toBe('action_required');
});
it('recognizes the matching owner session without claiming the actual wallet chain was checked',()=>{
 const check=setupReadiness({mode:'live',owner:'0xABC',account:{...account,owner:'0xabc'}},1000).find(c=>c.id==='wallet');
 expect(check?.state).toBe('ready');expect(check?.detail).toContain('network');
});
it('uses verified runtime permission and gas but never treats disabled execution as ready',()=>{
 const runtimeHealth={status:'checked' as const,authorized:false,gasBalance:'0',executionEnabled:false,executorAddress:'0xabc',blockNumber:'123'};
 const checks=setupReadiness({mode:'live',account,runtimeHealth},1000);
 expect(checks.find(c=>c.id==='executor')?.state).toBe('action_required');
 expect(checks.find(c=>c.id==='gas')?.state).toBe('action_required');
 expect(checks.find(c=>c.id==='execution')?.state).toBe('action_required');
});
it('reports observed executor funds and leaves an unobserved pause state unknown',()=>{
 const checks=setupReadiness({mode:'live',account,runtimeHealth:{status:'checked',authorized:true,gasBalance:'1',executionEnabled:true,executorAddress:'0xabc',blockNumber:'1'}},1000);
 expect(checks.find(c=>c.id==='gas')?.state).toBe('ready');
 expect(checks.find(c=>c.id==='execution')?.state).toBe('unknown');
});
it('explains unresolved transactions without suggesting another submission',()=>{
 expect(paymentGuidance('TX_UNRESOLVED').action).toMatch(/earlier transaction/);
 expect(paymentGuidance('SOMETHING_NEW').state).toBe('unknown');
});
it('shows current unpaid window and skips consumed periods without catch-up',()=>{
 const policy={startAt:'100',endAt:'160',intervalSeconds:'10'};
 expect(nextPaymentWindow(policy,'115',[])).toEqual({start:'110',end:'120'});
 expect(nextPaymentWindow(policy,'115',['1'])).toEqual({start:'120',end:'130'});
 expect(nextPaymentWindow(policy,'160',[])).toBeNull();
});
it('compares actual policy fields including expiry without hiding unchanged recipient',()=>{
 expect(policyChanges({version:'1',recipient:'a',endAt:'10'},{version:'2',recipient:'a',endAt:'20'})).toEqual([{field:'endAt',before:'10',after:'20'}]);
});
