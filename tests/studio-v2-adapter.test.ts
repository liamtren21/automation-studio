import {describe,it,expect,vi,afterEach} from 'vitest';
import {automationV2Capabilities,validateV2Policy,prepareV2OwnerAction,verifyV2Runtime,expectedV2Runtime,preflightV2Account,prepareV2LocalExecution,prepareV2OwnerActionChecked} from '../packages/mezo/src/automation-v2-adapter';
import {troveDeployment} from '../packages/mezo/src/trove-read';
const account='0x00000000000000000000000000000000000000A2' as const;
const owner='0x00000000000000000000000000000000000000A1' as const;
const p='0x00000000000000000000000000000000000000b1' as const;
const q='0x00000000000000000000000000000000000000b2' as const;
const id=`0x${'01'.repeat(32)}` as const;
const identity={account,owner,globalBudget:1000n};
const policy={id,version:1n,kind:0 as const,startAt:100n,endAt:1000n,interval:10n,runCap:10n,periodCap:10n,lifetimeCap:100n,enabled:false};
describe('V2 separate deployment capability',()=>{
 it('has no route enabling existing vault or unattended execution',()=>{expect(automationV2Capabilities.requiresNewDeployment).toBe(true);expect(automationV2Capabilities.liveWorkerEnabled).toBe(false);expect(automationV2Capabilities.defaultEnabled).toBe(false);});
 it('validates total batch amount and duplicate payees',()=>{expect(()=>validateV2Policy({...policy,runCap:9n},[p,q],[6n,4n])).toThrow();expect(()=>validateV2Policy(policy,[p,p],[5n,5n])).toThrow();});
 it('never invents recipient or permits enabled configuration without explicit review',()=>{expect(()=>prepareV2OwnerAction(identity,{type:'configure',policy:{...policy,enabled:true},payees:[p,q],values:[6n,4n]})).toThrow();const tx=prepareV2OwnerAction(identity,{type:'configure',policy,payees:[p,q],values:[6n,4n]});expect(tx.requiresOwnerSignature).toBe(true);expect(tx.to).toBe(account);expect(tx.value).toBe(0n);});
 it('accepts explicit bounded split remainder and rejects excessive bps',()=>{validateV2Policy({...policy,kind:1},[p,q],[6000n,3000n]);expect(()=>validateV2Policy({...policy,kind:1},[p,q],[6000n,5000n])).toThrow();});
 it('has exact original runtime identity including every immutable occurrence',()=>{const code=expectedV2Runtime(identity);expect(()=>verifyV2Runtime(identity,code)).not.toThrow();expect(()=>verifyV2Runtime(identity,`${code.slice(0,-2)}00` as `0x${string}`)).toThrow();expect(()=>verifyV2Runtime({...identity,globalBudget:999n},code)).toThrow();});
 it('borrowing is owner signed, account owns debt, no token allowance to BO',()=>{const tx=prepareV2OwnerAction(identity,{type:'openLoan',amount:50n,collateral:100n});expect(tx.to).toBe(account);expect(tx.value).toBe(100n);expect(tx.protocolTarget).toBe(troveDeployment.borrowerOperations);expect(tx.approvalRequired).toBe(false);});
});


import * as troveRead from '../packages/mezo/src/trove-read';
import type {PublicClient} from 'viem';
const client={getCode:vi.fn(),getBlock:vi.fn(),simulateContract:vi.fn()} as unknown as PublicClient;
afterEach(()=>vi.restoreAllMocks());
describe('V2 protocol and runtime preflight failure boundaries',()=>{
 it('propagates unreviewed protocol implementation failures before preparing any execution',async()=>{vi.spyOn(troveRead,'readTroveSnapshot').mockRejectedValue(new Error('Unreviewed protocol implementation: borrowerOperations'));await expect(preflightV2Account(client,identity,100)).rejects.toThrow(/Unreviewed/);});
 it('fails closed on a stale snapshot',async()=>{vi.spyOn(troveRead,'readTroveSnapshot').mockResolvedValue({blockTimestamp:70,blockNumber:'1',blockHash:'0xabc'} as troveRead.TroveSnapshot);await expect(preflightV2Account(client,identity,100)).rejects.toThrow(/stale/);});
 it('rejects any existing vault or incorrect new account runtime',async()=>{vi.spyOn(troveRead,'readTroveSnapshot').mockResolvedValue({blockTimestamp:99,blockNumber:'1',blockHash:'0xabc'} as troveRead.TroveSnapshot);vi.mocked(client.getCode).mockResolvedValue('0x1234');await expect(preflightV2Account(client,identity,100)).rejects.toThrow(/existing vaults/);});
 it('rejects a canonical-block change after code reads',async()=>{vi.spyOn(troveRead,'readTroveSnapshot').mockResolvedValue({blockTimestamp:99,blockNumber:'1',blockHash:'0xabc'} as troveRead.TroveSnapshot);vi.mocked(client.getCode).mockResolvedValue(expectedV2Runtime(identity));vi.mocked(client.getBlock).mockResolvedValue({hash:'0xdef'} as never);await expect(preflightV2Account(client,identity,100)).rejects.toThrow(/block changed/);});
 it('keeps live worker requests disabled even with an account address',async()=>{await expect(prepareV2LocalExecution(client,identity,{executor:p,id,version:1n,period:0n,live:true},100)).rejects.toThrow(/pending real protocol fork/);});
});
it('rejects reorgs that occur during owner simulation',async()=>{vi.spyOn(troveRead,'readTroveSnapshot').mockResolvedValue({blockTimestamp:99,blockNumber:'1',blockHash:'0xabc'} as troveRead.TroveSnapshot);vi.mocked(client.getCode).mockResolvedValue(expectedV2Runtime(identity));vi.mocked(client.getBlock).mockResolvedValueOnce({hash:'0xabc'} as never).mockResolvedValueOnce({hash:'0xdef'} as never);vi.mocked(client.simulateContract).mockResolvedValue({} as never);await expect(prepareV2OwnerActionChecked(client,identity,{type:'pause'},100)).rejects.toThrow(/block changed/);});
