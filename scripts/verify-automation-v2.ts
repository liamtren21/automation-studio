/** Local Anvil acceptance only. Uses public test mnemonic; never fund it externally. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http,parseEther,encodeFunctionData,keccak256,toHex,type Address,type Hex} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {automationVaultAbi} from '../packages/mezo/src/automation-abi';
import {automationDeploymentData,policyTuple} from '../packages/mezo/src/automation-payload';
import {readAutomationVault} from '../packages/mezo/src/automation-chain';
import {verifyAutomationReceipt} from '../packages/mezo/src/automation-receipt';
import {hashPolicy,type StudioPolicy} from '../packages/automation/src/studio';
import {officialTestnetMusd,mezoTestnet} from '../packages/mezo/src/network';
const rpc=process.env.MEZO_RPC_URL;
if(rpc!=='http://127.0.0.1:8549')throw new Error('This acceptance script only runs on local Anvil8549.');
const p=createPublicClient({transport:http(rpc)}),owner=mnemonicToAccount('test test test test test test test test test test test junk'),executor=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:1});
const w=createWalletClient({account:owner,chain:mezoTestnet,transport:http(rpc)}),e=createWalletClient({account:executor,chain:mezoTestnet,transport:http(rpc)});
const mock=JSON.parse(await readFile('contracts/out/AutomationVault.t.sol/AutomationToken.json','utf8'));
await p.request({method:'anvil_setCode' as never,params:[officialTestnetMusd,mock.deployedBytecode.object] as never});
const deployed=await p.waitForTransactionReceipt({hash:await w.sendTransaction({data:automationDeploymentData(owner.address,'30')})});
const vault=deployed.contractAddress!;
const txs:{action:string;hash:Hex;block:string}[]=[];
async function action(name:string,functionName:string,args:readonly unknown[],signer=w){const hash=await signer.writeContract({address:vault,abi:automationVaultAbi,functionName:functionName as never,args:args as never});const r=await p.waitForTransactionReceipt({hash});assert.equal(r.status,'success');txs.push({action:name,hash,block:r.blockNumber.toString()});return{hash,r};}
await p.waitForTransactionReceipt({hash:await w.writeContract({address:officialTestnetMusd,abi:mock.abi,functionName:'mint',args:[vault,parseEther('50')]})});
const start=(await p.getBlock()).timestamp+20n,id=keccak256(toHex('local-acceptance-policy'));
const policy:StudioPolicy={chainId:'31611',vault,policyId:id,version:'1',recipient:owner.address,amount:parseEther('5').toString(),startAt:start.toString(),endAt:(start+1000n).toString(),intervalSeconds:'10',perRunCap:parseEther('5').toString(),perPeriodCap:parseEther('5').toString(),lifetimeCap:parseEther('30').toString(),priority:'1',enabled:true};
await action('protection','setProtection',[parseEther('10'),parseEther('10'),keccak256(toHex('local-obligations')),start+1000n]);
await action('configure','configurePolicy',[policyTuple(policy)]);
assert.equal(await p.readContract({address:vault,abi:automationVaultAbi,functionName:'hashPolicy',args:[policyTuple(policy)]}),hashPolicy(policy));
await action('allocate','allocate',[id,parseEther('30')]);await action('executor','setExecutor',[executor.address,true]);
for(let i=0;i<6;i++){
 await p.request({method:'evm_setNextBlockTimestamp' as never,params:[Number(start)+i*10] as never});
 const {hash,r}=await action('payout-'+i,'executePayout',[id,1n,BigInt(i)],e);
 const tx=await p.getTransaction({hash});
 assert.equal(verifyAutomationReceipt({vault,recipient:policy.recipient,executor:executor.address,token:officialTestnetMusd,policyId:id,version:'1',periodIndex:String(i),amount:policy.amount,policyHash:hashPolicy(policy),nonce:tx.nonce,expectedData:encodeFunctionData({abi:automationVaultAbi,functionName:'executePayout',args:[id,1n,BigInt(i)]}),tx,receipt:r,canonicalBlockHash:(await p.getBlock({blockNumber:r.blockNumber})).hash}),'confirmed');
 if(i===0)await assert.rejects(()=>p.simulateContract({account:executor,address:vault,abi:automationVaultAbi,functionName:'executePayout',args:[id,1n,0n]}));
}
await p.request({method:'evm_setNextBlockTimestamp' as never,params:[Number(start)+60] as never});await p.request({method:'evm_mine' as never});
await assert.rejects(()=>p.simulateContract({account:executor,address:vault,abi:automationVaultAbi,functionName:'executePayout',args:[id,1n,6n]}));
const state=await readAutomationVault(vault,owner.address);assert.equal(state.balance,parseEther('20').toString());assert.equal(state.globalSpent,parseEther('30').toString());
await mkdir('.data',{recursive:true});
await writeFile('.data/automation-local-evidence.json',JSON.stringify({scope:'local Anvil only; not Mezo Testnet transactions',chainId:31611,vault,owner:owner.address,executor:executor.address,startingBalance:'50',protectedBills:'10',buffer:'10',periodAmount:'5',totalPaid:'30',endingBalance:'20',seventhRejected:true,duplicateRejected:true,policyHash:hashPolicy(policy),deployment:deployed.transactionHash,txs,checkedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({scope:'local Anvil',sixPaymentsVerified:true,seventhRejected:true,duplicateRejected:true,endingBalance:'20 MUSD',vault}));
