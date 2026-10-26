import {it,expect} from 'vitest';
import {encodeEventTopics,erc20Abi} from 'viem';
import {verifyGroupFundingReceipt,groupFundingData} from '../packages/mezo/src/automation-v2-funding';
import {officialTestnetMusd} from '../packages/mezo/src/network';
const owner='0x8862e18ac653ac4123dbc0d12528cdbf5402dce8',account='0x52DD91F102682075E1Fe2D232558366d014Eae5A',amount='20000000000000000',hash='0x'+'12'.repeat(32);
const tx={from:owner,to:officialTestnetMusd,input:groupFundingData(account,amount),value:0n};
const receipt={status:'success',blockHash:hash,logs:[{address:officialTestnetMusd,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:owner,to:account}}),data:('0x'+BigInt(amount).toString(16).padStart(64,'0'))}]};
it('requires the exact owner token transfer and one matching canonical Transfer event',()=>{
 expect(verifyGroupFundingReceipt({owner,account,amount,tx,receipt,canonicalBlockHash:hash} as never)).toBe(true);
 for(const bad of [{tx:{...tx,to:account}},{tx:{...tx,from:account}},{tx:{...tx,value:1n}},{receipt:{...receipt,status:'reverted'}},{receipt:{...receipt,logs:[]}},{canonicalBlockHash:'0x'+'34'.repeat(32)}])expect(()=>verifyGroupFundingReceipt({owner,account,amount,tx,receipt,canonicalBlockHash:hash,...bad} as never)).toThrow();
});
it('cannot turn a deposit into allowance or overflow amount',()=>{
 expect(groupFundingData(account,amount)).toMatch(/^0xa9059cbb/);
 expect(()=>groupFundingData(account,'0')).toThrow();expect(()=>groupFundingData(account,(-1n).toString())).toThrow();expect(()=>groupFundingData(account,(2n**256n).toString())).toThrow();
});
