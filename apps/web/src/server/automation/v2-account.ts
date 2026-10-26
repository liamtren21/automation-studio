import {getAddress,type Address,type Hex} from 'viem';
import type {Database} from '../../../../../packages/db/src/database';
import {automationV2DeploymentData} from '../../../../../packages/mezo/src/automation-v2-deployment';
import {publicClient,officialTestnetMusd} from '../../../../../packages/mezo/src/network';
import {verifyV2Runtime} from '../../../../../packages/mezo/src/automation-v2-adapter';
import {readTroveSnapshot,type TroveSnapshot} from '../../../../../packages/mezo/src/trove-read';
import {parseMusd} from '../../../../../packages/domain/src/money';
export interface V2AccountBinding {address:Address;owner:Address;globalBudget:string;txHash:Hex;blockNumber:string;body:{blockHash:string;protocolBlock:string;protocolHash:string;batchOnly:true;executionEnabled:false;funding?:{draftId:string;txHash:Hex;amount:string;blockNumber:string;blockHash:string}}}
const gate=()=>{if(process.env.STUDIO_V2_BATCH_DEPLOYMENT!=='true')throw Error('Group payment account deployment is not enabled yet.');};
type Reader=Pick<ReturnType<typeof publicClient>,'getChainId'|'getTransactionReceipt'|'getTransaction'|'getBlockNumber'|'getBlock'|'getCode'|'estimateGas'>;
type ProtocolReader=(client:Reader,address:Address)=>Promise<TroveSnapshot>;
const protocolReader:ProtocolReader=(client,address)=>readTroveSnapshot(client as unknown as Parameters<typeof readTroveSnapshot>[0],address);
async function freshProtocol(client:Reader,address:Address,reader:ProtocolReader){const snapshot=await reader(client,address),now=Math.floor(Date.now()/1000);if(snapshot.blockTimestamp>now||now-snapshot.blockTimestamp>=30)throw Error('Group account protocol check is stale. Try again shortly.');return snapshot;}
export async function getV2Account(db:Database,workspace:string):Promise<V2AccountBinding|null>{
 const row=(await db.query<{address:Address;owner:Address;global_budget:string;tx_hash:Hex;block_number:string;body:V2AccountBinding['body']}>('SELECT address,owner,global_budget::text,tx_hash,block_number::text,body FROM studio_v2_accounts WHERE workspace_id=$1',[workspace])).rows[0];
 return row?{address:row.address,owner:row.owner,globalBudget:row.global_budget,txHash:row.tx_hash,blockNumber:row.block_number,body:row.body}:null;
}
export async function prepareV2Deployment(owner:Address,budget:string,client:Reader=publicClient(),readProtocol:ProtocolReader=protocolReader){
 gate();const data=automationV2DeploymentData(owner,budget);if(await client.getChainId()!==31611)throw Error('Wrong deployment chain.');
 const snapshot=await freshProtocol(client,owner,readProtocol);await client.estimateGas({account:owner,data,value:0n});
 if((await client.getBlock({blockNumber:BigInt(snapshot.blockNumber)})).hash!==snapshot.blockHash)throw Error('Group account protocol check changed.');
 return {transaction:{data,value:'0x0' as const,chainId:31611 as const},review:{owner:getAddress(owner),globalBudget:budget,token:officialTestnetMusd},expiresAt:Date.now()+30000};
}
export async function verifyV2DeploymentProof(owner:Address,hash:Hex,budget:string,client:Reader=publicClient(),readProtocol:ProtocolReader=protocolReader):Promise<V2AccountBinding>{
 gate();const expected=automationV2DeploymentData(owner,budget);if(!/^0x[\da-f]{64}$/i.test(hash))throw Error('A deployment transaction hash is required.');
 if(await client.getChainId()!==31611)throw Error('Wrong deployment chain.');
 const [receipt,tx,head]=await Promise.all([client.getTransactionReceipt({hash}),client.getTransaction({hash}),client.getBlockNumber()]);
 if(tx.from.toLowerCase()!==owner.toLowerCase()||tx.to!==null||tx.value!==0n||tx.input.toLowerCase()!==expected.toLowerCase())throw Error('Deployment does not match the exact owner and account budget.');
 if(receipt.status!=='success'||!receipt.contractAddress)throw Error('Deployment receipt is not a successful contract creation.');
 const block=await client.getBlock({blockNumber:receipt.blockNumber});if(head<receipt.blockNumber+1n||block.hash!==receipt.blockHash)throw Error('Deployment confirmation is pending.');
 const identity={account:receipt.contractAddress,owner,globalBudget:parseMusd(budget)};
 verifyV2Runtime(identity,await client.getCode({address:receipt.contractAddress,blockNumber:receipt.blockNumber}));
 const snapshot=await freshProtocol(client,receipt.contractAddress,readProtocol);
 verifyV2Runtime(identity,await client.getCode({address:receipt.contractAddress,blockNumber:BigInt(snapshot.blockNumber)}));
 if((await client.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash||(await client.getBlock({blockNumber:BigInt(snapshot.blockNumber)})).hash!==snapshot.blockHash)throw Error('Deployment confirmation changed.');
 return {address:getAddress(receipt.contractAddress),owner:getAddress(owner),globalBudget:identity.globalBudget.toString(),txHash:hash,blockNumber:receipt.blockNumber.toString(),body:{blockHash:receipt.blockHash,protocolBlock:snapshot.blockNumber,protocolHash:snapshot.blockHash,batchOnly:true,executionEnabled:false}};
}
export async function bindV2Deployment(db:Database,workspace:string,owner:Address,hash:Hex,budget:string,client:Reader=publicClient(),readProtocol:ProtocolReader=protocolReader){
 if(workspace!=='live:'+owner.toLowerCase())throw Error('Group account owner does not match this workspace.');
 const binding=await verifyV2DeploymentProof(owner,hash,budget,client,readProtocol);
 await db.transaction(async q=>{
  await q.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[workspace]);
  const existing=await getV2Account(q as Database,workspace);
  if(existing&&(existing.address.toLowerCase()!==binding.address.toLowerCase()||existing.globalBudget!==binding.globalBudget||existing.txHash.toLowerCase()!==hash.toLowerCase()))throw Error('This workspace already has another group payment account.');
  await q.query('INSERT INTO studio_v2_accounts(workspace_id,address,owner,global_budget,tx_hash,block_number,body) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(workspace_id) DO NOTHING',[workspace,binding.address.toLowerCase(),binding.owner.toLowerCase(),binding.globalBudget,hash,binding.blockNumber,JSON.stringify(binding.body)]);
 });return binding;
}
