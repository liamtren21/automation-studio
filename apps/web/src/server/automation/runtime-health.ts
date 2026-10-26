import {isAddress,type Address} from 'viem';
import {automationVaultAbi} from '../../../../../packages/mezo/src/automation-abi';
import {privateKeyToAccount} from 'viem/accounts';

export function executorConfiguration(address:string|undefined,key:string|undefined){
 if(!key||!/^0x[0-9a-f]{64}$/i.test(key))return {address:undefined,identityVerified:false};
 try{const actual=privateKeyToAccount(key as `0x${string}`).address;if(address&&(!isAddress(address)||address.toLowerCase()!==actual.toLowerCase()))return {address:undefined,identityVerified:false};return {address:actual,identityVerified:true};}catch{return {address:undefined,identityVerified:false};}
}

interface HealthReader {
 readContract(input:{address:Address;abi:typeof automationVaultAbi;functionName:'executors';args:readonly[Address];blockNumber:bigint}):Promise<boolean>;
 getBalance(input:{address:Address;blockNumber:bigint}):Promise<bigint>;
}
export async function readRuntimeHealth(vault:Address,block:bigint,reader:HealthReader,config:{address?:string;enabled:boolean;identityVerified?:boolean}) {
 const base={executorAddress:config.address&&isAddress(config.address)?config.address:null,authorized:null as boolean|null,gasBalance:null as string|null,executionEnabled:config.enabled,blockNumber:block.toString(),checkedAt:new Date().toISOString()};
 if(!base.executorAddress||config.identityVerified===false)return {...base,status:'unconfigured' as const};
 try {
  const executor=base.executorAddress as Address;
  const [authorized,gas]=await Promise.all([reader.readContract({address:vault,abi:automationVaultAbi,functionName:'executors',args:[executor],blockNumber:block}),reader.getBalance({address:executor,blockNumber:block})]);
  return {...base,authorized,gasBalance:gas.toString(),status:'checked' as const};
 }catch{return {...base,status:'unknown' as const};}
}
