import {describe,it,expect} from 'vitest';
import {createWalletStartGate,confirmationFailure,watchConfirmation,walletRequestDeclined} from '../apps/web/src/features/automation/wallet-flow';
describe('wallet action orchestration',()=>{
 it('recognizes nested wallet declines without calling RPC timeouts a rejection',()=>{
  expect(walletRequestDeclined({data:{originalError:{code:4001}}})).toBe(true);
  expect(walletRequestDeclined({cause:{code:4001}})).toBe(true);
  expect(walletRequestDeclined(Error('timeout'))).toBe(false);
 });
 it('opens only one automatic request when preparation and provider are ready',()=>{
  const start=createWalletStartGate(),state={ready:false,provider:true,hash:'',uncertain:false,busy:false};
  expect(start('stop',state)).toBe(false);
  expect(start('stop',{...state,ready:true,provider:false})).toBe(false);
  expect(start('stop',{...state,ready:true,busy:true})).toBe(false);
  expect(start('stop',{...state,ready:true})).toBe(true);
  expect(start('stop',{...state,ready:true})).toBe(false);
 });
 it('never automatically sends after recovering a hash or an uncertain request',()=>{
  const start=createWalletStartGate(),state={ready:true,provider:true,hash:'',uncertain:false,busy:false};
  expect(start('stored',{...state,hash:'0x1234'})).toBe(false);
  expect(start('unknown',{...state,uncertain:true})).toBe(false);
 });
 it('keeps RPC absence pending, confirms once, and does not expose a resend operation',async()=>{
  const events:string[]=[];let reads=0;
  await watchConfirmation({check:async()=>{events.push('check');if(++reads<3)throw Error('Transaction with hash could not be found.');},cancelled:()=>false,sleep:async()=>{},onConfirmed:()=>events.push('success'),onFailed:()=>events.push('failed'),onWaiting:()=>events.push('waiting'),onTimeout:()=>events.push('timeout')});
  expect(events).toEqual(['check','waiting','check','waiting','check','success']);
 });
 it('reports a proven revert but never treats an RPC timeout as failure',()=>{
  expect(confirmationFailure(Error('Transaction reverted. Review the current account state.'))).toContain('reverted');
  expect(confirmationFailure(Error('HTTP request timed out'))).toBeNull();
  expect(confirmationFailure(Error('Transaction confirmation is pending.'))).toBeNull();
 });
 it('stops polling at the limit and does not publish results after cancellation',async()=>{
  let cancelled=false,reads=0;const events:string[]=[];
  const ports={check:async()=>{reads++;throw Error('pending');},cancelled:()=>cancelled,sleep:async()=>{},onConfirmed:()=>events.push('success'),onFailed:()=>events.push('failed'),onWaiting:()=>events.push('waiting'),onTimeout:()=>events.push('timeout')};
  await watchConfirmation(ports,2);expect(reads).toBe(2);expect(events).toEqual(['waiting','waiting','timeout']);
  events.length=0;await watchConfirmation({...ports,check:async()=>{cancelled=true;}});expect(events).toEqual([]);
 });
});
