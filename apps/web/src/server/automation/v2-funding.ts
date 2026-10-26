import type {Database} from '../../../../../packages/db/src/database';
import {getV2Account} from './v2-account';
import {listBatchDrafts} from './batch-drafts';
import {preflightV2Account} from '../../../../../packages/mezo/src/automation-v2-adapter';
import {publicClient,officialTestnetMusd} from '../../../../../packages/mezo/src/network';
import {groupFundingData,verifyGroupFundingReceipt} from '../../../../../packages/mezo/src/automation-v2-funding';
import {erc20Abi,type Address,type Hex} from 'viem';
async function fundingContext(db:Database,workspace:string,owner:Address,draftId:string){
 if(process.env.STUDIO_V2_BATCH_DEPLOYMENT!=='true'||workspace!=='live:'+owner.toLowerCase())throw Error('Sign in with the owner wallet for group payments.');
 const binding=await getV2Account(db,workspace),saved=(await listBatchDrafts(db,workspace)).find(d=>d.id===draftId);
 if(!binding||binding.owner.toLowerCase()!==owner.toLowerCase()||!saved)throw Error('Group payment account or draft not found.');
 if(BigInt(saved.draft.totalPerBatch)>BigInt(binding.globalBudget))throw Error('The group payment exceeds this account spending limit.');
 const preflight=await preflightV2Account(publicClient(),{account:binding.address,owner,globalBudget:BigInt(binding.globalBudget)});
 return {binding,saved,preflight};
}
export async function prepareV2Funding(db:Database,workspace:string,owner:Address,draftId:string){
 const {binding,saved,preflight}=await fundingContext(db,workspace,owner,draftId),amount=saved.draft.totalPerBatch,p=publicClient(),blockNumber=BigInt(preflight.snapshot.blockNumber);
 const balance=await p.readContract({address:officialTestnetMusd,abi:erc20Abi,functionName:'balanceOf',args:[binding.address],blockNumber});
 if(balance!==0n)throw Error('This group account already contains MUSD. Check its balance before adding more.');
 const data=groupFundingData(binding.address,amount);await p.call({account:owner,to:officialTestnetMusd,data,value:0n,blockNumber});
 if((await p.getBlock({blockNumber})).hash!==preflight.snapshot.blockHash)throw Error('Deposit review changed. Try again.');
 return {transaction:{to:officialTestnetMusd,data,value:'0x0',chainId:31611},review:{owner,account:binding.address,draftId,amount},expiresAt:Date.now()+30000};
}
export async function confirmV2Funding(db:Database,workspace:string,owner:Address,draftId:string,hash:Hex){
 const {binding,saved}=await fundingContext(db,workspace,owner,draftId),p=publicClient();
 if(!/^0x[0-9a-f]{64}$/i.test(hash)||await p.getChainId()!==31611)throw Error('Invalid deposit confirmation.');
 const [tx,receipt,head]=await Promise.all([p.getTransaction({hash}),p.getTransactionReceipt({hash}),p.getBlockNumber()]),block=await p.getBlock({blockNumber:receipt.blockNumber});
 if(head<receipt.blockNumber+1n)throw Error('Deposit confirmation is pending.');
 verifyGroupFundingReceipt({owner,account:binding.address,amount:saved.draft.totalPerBatch,tx,receipt,canonicalBlockHash:block.hash});
 const funding={draftId,txHash:hash,amount:saved.draft.totalPerBatch,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash};
 await db.query("UPDATE studio_v2_accounts SET body=jsonb_set(body,'{funding}',$3::jsonb) WHERE workspace_id=$1 AND address=$2",[workspace,binding.address.toLowerCase(),JSON.stringify(funding)]);
 return {confirmed:true,funding};
}
