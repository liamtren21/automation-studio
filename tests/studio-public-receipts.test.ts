import {expect,it,afterEach} from 'vitest';
import {createDatabase,type Database} from '../packages/db/src/database';
import {createRunShare,readRunShare,verifyPublicRun,receiptCsv} from '../apps/web/src/server/automation/run-receipts';
import {encodeAbiParameters,encodeEventTopics,encodeFunctionData,erc20Abi,keccak256} from 'viem';
import {automationVaultAbi} from '../packages/mezo/src/automation-abi';
import {officialTestnetMusd} from '../packages/mezo/src/network';
import {createAutomationPolicy} from '../packages/db/src/automation';
import {hashPolicy,type StudioPolicy} from '../packages/automation/src/studio';
const vault='0x1111111111111111111111111111111111111111',recipient='0x2222222222222222222222222222222222222222',executor='0x3333333333333333333333333333333333333333';
const policy:StudioPolicy={chainId:'31611',vault,policyId:keccak256('0x01'),version:'1',recipient,amount:'5',startAt:'100',endAt:'1000',intervalSeconds:'60',perRunCap:'5',perPeriodCap:'5',lifetimeCap:'50',priority:'1',enabled:true};
const txHash=keccak256('0x02'),blockHash=keccak256('0x03'),data=encodeFunctionData({abi:automationVaultAbi,functionName:'executePayout',args:[policy.policyId,1n,0n]});
const stored={policy,periodIndex:'0',txHash,nonce:'4',executor};
const receipt={status:'success',blockNumber:5n,blockHash,logs:[
 {address:vault,logIndex:0,topics:encodeEventTopics({abi:automationVaultAbi,eventName:'PayoutExecuted',args:{policyId:policy.policyId,version:1n,periodIndex:0n}}),data:encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'bytes32'}],[recipient,5n,hashPolicy(policy)])},
 {address:officialTestnetMusd,logIndex:1,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:vault,to:recipient}}),data:encodeAbiParameters([{type:'uint256'}],[5n])},
]};
const reader={getChainId:async()=>31611,getBlockNumber:async()=>6n,getTransaction:async()=>({from:executor,to:vault,input:data,value:0n,nonce:4}),getTransactionReceipt:async()=>receipt,getBlock:async()=>({hash:blockHash})};
it('verifies the original policy, exact event and canonical confirmations on each read',async()=>{
 expect(await verifyPublicRun(stored,reader)).toMatchObject({status:'confirmed',amount:'5',recipient,version:'1',periodIndex:'0',blockNumber:'5',confirmations:'2',payoutLogIndex:0,transferLogIndex:1});
 expect(await verifyPublicRun(stored,{...reader,getBlock:async()=>({hash:txHash})})).toMatchObject({status:'pending'});
 expect(await verifyPublicRun(stored,{...reader,getBlockNumber:async()=>5n})).toMatchObject({status:'pending'});
 expect(await verifyPublicRun(stored,{...reader,getChainId:async()=>1})).toMatchObject({status:'unverified'});
 expect(await verifyPublicRun(stored,{...reader,getTransactionReceipt:async()=>({...receipt,logs:receipt.logs.slice(0,1)})})).toMatchObject({status:'unverified'});
 expect(await verifyPublicRun(stored,{...reader,getTransaction:async()=>{throw Error('secret endpoint');}})).toMatchObject({status:'unavailable'});
});
it('escapes formula cells and preserves long base-unit integers in CSV',()=>{
 const csv=receiptCsv({label:' =HYPERLINK("bad")',amount:'1000000000000000000'});expect(csv).toContain("' =HYPERLINK");expect(csv).toContain("'1000000000000000000");
});
const dbs:Database[]=[];afterEach(async()=>{for(const d of dbs.splice(0))await d.close();});
it('shares only an owned live run with consent, excludes journal secrets and honors revocation',async()=>{
 const db=await createDatabase('memory://');dbs.push(db);
 await db.query("INSERT INTO workspaces(id,mode) VALUES('live:a','live'),('live:b','live')");
 await createAutomationPolicy(db,'live:a',policy);
 await db.query("INSERT INTO automation_runs(id,workspace_id,chain_id,vault,policy_id,version,period_index,state) VALUES('run','live:a',31611,$1,$2,1,0,'confirmed')",[vault,policy.policyId]);
 await db.query("INSERT INTO automation_attempts(id,workspace_id,run_id,attempt_id,nonce,fencing_token,intent,raw_transaction,tx_hash) VALUES('attempt','live:a','run','initial',4,1,$1::jsonb,'SECRET_SIGNED_BYTES',$2)",[JSON.stringify({executor}),txHash]);
 await expect(createRunShare(db,'live:b','run',true,100)).rejects.toThrow();
 await expect(createRunShare(db,'live:a','run',false,100)).rejects.toThrow();
 const share=await createRunShare(db,'live:a','run',true,100);
 const out=await readRunShare(db,share.token,reader,101);expect(out).toMatchObject({status:'confirmed',amount:'5'});
 expect(JSON.stringify(out)).not.toMatch(/SECRET|raw_transaction|workspace|intent/);
 await db.query('UPDATE automation_share_tokens SET revoked=true');
 expect(await readRunShare(db,share.token,reader,102)).toBeNull();
},20000);
