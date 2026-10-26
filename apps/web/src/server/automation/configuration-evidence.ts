import {decodeFunctionData,decodeEventLog,type Hex} from 'viem';
import type {Database} from '../../../../../packages/db/src/database';
import type {StudioPolicy} from '../../../../../packages/automation/src/studio';
import {automationVaultAbi} from '../../../../../packages/mezo/src/automation-abi';
import {automationOperationData} from '../../../../../packages/mezo/src/automation-payload';
/** Accepts only the already canonical, owner-bound confirmation returned by verifyStudioConfirmation. */
export async function recordConfigurationEvidence(db:Database,workspace:string,proof:{tx:{from:string;to:string|null;input:string;hash:string};receipt:{blockNumber:bigint;blockHash:string;logs:readonly{address:string;topics:readonly unknown[];data:string}[]};block:{timestamp:bigint}}){
 let decoded:ReturnType<typeof decodeFunctionData<typeof automationVaultAbi>>;
 try{decoded=decodeFunctionData({abi:automationVaultAbi,data:proof.tx.input as Hex});}catch{return;}
 if(decoded.functionName!=='configurePolicy'||!proof.tx.to)return;
 const tuple=decoded.args[0];
 const row=(await db.query<{body:StudioPolicy;config_hash:string}>('SELECT body,config_hash FROM automation_policies WHERE workspace_id=$1 AND vault=$2 AND policy_id=$3 AND version=$4',[workspace,proof.tx.to.toLowerCase(),tuple.policyId.toLowerCase(),tuple.version.toString()])).rows[0];
 if(!row)throw new Error('Confirmed configuration does not belong to this workspace.');
 const expected=automationOperationData({operation:'configure',owner:proof.tx.from as `0x${string}`,vault:proof.tx.to as `0x${string}`,policy:row.body});
 if(expected.data.toLowerCase()!==proof.tx.input.toLowerCase())throw new Error('Confirmed configuration differs from this policy version.');
 let matches=0;
 for(const log of proof.receipt.logs)if(log.address.toLowerCase()===proof.tx.to.toLowerCase())try{const e=decodeEventLog({abi:automationVaultAbi,eventName:'PolicyConfigured',topics:log.topics as [Hex,...Hex[]],data:log.data as Hex});if(e.args.policyId.toLowerCase()===row.body.policyId.toLowerCase()&&e.args.version===BigInt(row.body.version)&&e.args.policyHash.toLowerCase()===row.config_hash.toLowerCase())matches++;}catch{/* Ignore unrelated events. */}
 if(matches!==1)throw new Error('Configuration receipt lacks the exact policy event.');
 await db.query('INSERT INTO studio_configuration_evidence(workspace_id,policy_id,version,config_hash,tx_hash,block_number,block_hash,effective_at,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',[workspace,row.body.policyId,row.body.version,row.config_hash,proof.tx.hash,proof.receipt.blockNumber.toString(),proof.receipt.blockHash,proof.block.timestamp.toString(),String(Math.floor(Date.now()/1000))]);
}
