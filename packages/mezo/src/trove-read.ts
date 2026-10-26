import { keccak256, parseAbi, type Address, type PublicClient } from 'viem';
import {getAddress,isAddress} from 'viem';
const address=(value:string)=>{if(!isAddress(value))throw new Error('Enter a valid borrower address');return getAddress(value);};

/** Addresses and ABI signatures inspected in official musd matsnet deployment artifacts. */
export const troveDeployment={
 chainId:31611,sourceCommit:'b51f6cb8e0f048770e32cb6ab5d704785e0b75b1',
 borrowerOperations:'0xCdF7028ceAB81fA0C6971208e83fa7872994beE5',
 troveManager:'0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
 interestRateManager:'0xD4D6c36A592A2c5e86035A6bca1d57747a567f37',
 priceFeed:'0x86bCF0841622a5dAC14A313a15f96A95421b9366',
 sortedTroves:'0x722E4D24FD6Ff8b0AC679450F3D91294607268fA',
 hintHelpers:'0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6',
 musd:'0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
} as const;
export const troveImplementations={borrowerOperations:'0xc05Bf344BD5b58825784326dD3112fB6cC160dcC',troveManager:'0x9aAB567966983e95536FC460C12266FB0Cc10B07',interestRateManager:'0xAA13B1d9CFFA3F44ab3A8BE0dC8774FB7841459C',priceFeed:'0xec42B37C12b8D73d320f4075A1BCd58B306629c1',sortedTroves:'0x9177DF58A9614b84C8c2F68dF27506AB9a5d0323',hintHelpers:'0x8adF3f35dBE4026112bCFc078872bcb967732Ea8'} as const;
const IMPLEMENTATION_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const troveAbi=parseAbi([
 'function troveManager() view returns (address)','function musd() view returns (address)','function musdToken() view returns (address)',
 'function borrowerOperations() view returns (address)','function interestRateManager() view returns (address)','function priceFeed() view returns (address)','function sortedTroves() view returns (address)',
 'function getTroveStatus(address) view returns (uint8)','function getEntireDebtAndColl(address) view returns (uint256 coll,uint256 principal,uint256 interest,uint256 pendingCollateral,uint256 pendingPrincipal,uint256 pendingInterest)',
 'function getTroveInterestRate(address) view returns (uint16)','function interestRate() view returns (uint16)',
 'function minNetDebt() view returns (uint256)','function MUSD_GAS_COMPENSATION() view returns (uint256)',
 'function MCR() view returns (uint256)','function CCR() view returns (uint256)',
 'function fetchPrice() view returns (uint256)','function getCurrentICR(address,uint256) view returns (uint256)',
 'function checkRecoveryMode(uint256) view returns (bool)','function balanceOf(address) view returns (uint256)','function decimals() view returns (uint8)',
 'function getSize() view returns (uint256)','function getApproxHint(uint256,uint256,uint256) view returns (address,uint256,uint256)',
 'function computeNominalCR(uint256,uint256) pure returns (uint256)','function findInsertPosition(uint256,address,address) view returns (address,address)',
 'function repayMUSD(uint256,address,address)',
]);
type Client=Pick<PublicClient,'getChainId'|'getBlock'|'getCode'|'getStorageAt'|'readContract'|'getBalance'>;
export interface TroveSnapshot {
 chainId:31611;sourceCommit:string;borrower:Address;blockNumber:string;blockHash:string;blockTimestamp:number;
 statusCode:number;status:'nonexistent'|'active'|'closed_by_owner'|'closed_by_liquidation'|'closed_by_redemption';
 collateralBaseUnits:string;principalBaseUnits:string;interestBaseUnits:string;debtBaseUnits:string;
 pendingCollateralBaseUnits:string;pendingPrincipalBaseUnits:string;pendingInterestBaseUnits:string;
 priceBaseUnits:string;icrBaseUnits:string;minimumCollateralRatioBaseUnits:string;criticalCollateralRatioBaseUnits:string;recoveryMode:boolean;
 minNetDebtBaseUnits:string;gasCompensationBaseUnits:string;troveInterestRateBps:number;currentInterestRateBps:number;
 ownerMusdBalanceBaseUnits:string;ownerGasBalanceBaseUnits:string;codeHashes:Record<string,string>;
}
const statuses=['nonexistent','active','closed_by_owner','closed_by_liquidation','closed_by_redemption'] as const;
function read<T>(client:Client,contract:Address,blockNumber:bigint,functionName:string,args:readonly unknown[]=[]):Promise<T>{
 return client.readContract({address:contract,abi:troveAbi,functionName,args,blockNumber} as Parameters<Client['readContract']>[0]) as Promise<T>;
}
async function canonical(client:Client,number:bigint,hash:string){if((await client.getBlock({blockNumber:number})).hash!==hash)throw new Error('Trove snapshot block changed');}
export async function readTroveSnapshot(client:Client,borrowerInput:string):Promise<TroveSnapshot>{
 const borrower=address(borrowerInput),d=troveDeployment;
 if(await client.getChainId()!==d.chainId)throw new Error('Wrong chain for Mezo Trove');
 const block=await client.getBlock();if(!block.hash||block.number===null)throw new Error('Mined block required');const n=block.number;
 const codeHashes:Record<string,string>={};
 await Promise.all((['borrowerOperations','troveManager','interestRateManager','priceFeed','sortedTroves','hintHelpers','musd'] as const).map(async key=>{const code=await client.getCode({address:d[key],blockNumber:n});if(!code||code==='0x')throw new Error(`Missing deployed ${key}`);codeHashes[key]=keccak256(code);}));
 await Promise.all((Object.keys(troveImplementations) as (keyof typeof troveImplementations)[]).map(async key=>{
  const storage=await client.getStorageAt({address:d[key],slot:IMPLEMENTATION_SLOT,blockNumber:n});
  if(!storage||storage.length!==66||storage.slice(-40).toLowerCase()!==troveImplementations[key].slice(2).toLowerCase())throw new Error(`Unreviewed protocol implementation: ${key}`);
  const implementationCode=await client.getCode({address:troveImplementations[key],blockNumber:n});if(!implementationCode||implementationCode==='0x')throw new Error(`Missing implementation code: ${key}`);codeHashes[`${key}Implementation`]=keccak256(implementationCode);
 }));
 const links=[ [d.borrowerOperations,'troveManager',d.troveManager],[d.borrowerOperations,'musd',d.musd],[d.borrowerOperations,'interestRateManager',d.interestRateManager],[d.borrowerOperations,'priceFeed',d.priceFeed],[d.borrowerOperations,'sortedTroves',d.sortedTroves],[d.troveManager,'borrowerOperations',d.borrowerOperations],[d.troveManager,'musdToken',d.musd],[d.troveManager,'interestRateManager',d.interestRateManager],[d.troveManager,'priceFeed',d.priceFeed],[d.troveManager,'sortedTroves',d.sortedTroves],[d.hintHelpers,'troveManager',d.troveManager],[d.sortedTroves,'troveManager',d.troveManager] ] as const;
 await Promise.all(links.map(async([target,name,expected])=>{if(address(await read<string>(client,target,n,name))!==address(expected))throw new Error(`Protocol deployment mismatch: ${name}`);}));
 const [statusCode,entire,troveRate,currentRate,minDebt,gasComp,mcr,ccr,price,balance,gas,decimals]=await Promise.all([
  read<number>(client,d.troveManager,n,'getTroveStatus',[borrower]),read<readonly bigint[]>(client,d.troveManager,n,'getEntireDebtAndColl',[borrower]),
  read<number>(client,d.troveManager,n,'getTroveInterestRate',[borrower]),read<number>(client,d.interestRateManager,n,'interestRate'),read<bigint>(client,d.borrowerOperations,n,'minNetDebt'),read<bigint>(client,d.borrowerOperations,n,'MUSD_GAS_COMPENSATION'),read<bigint>(client,d.borrowerOperations,n,'MCR'),read<bigint>(client,d.borrowerOperations,n,'CCR'),read<bigint>(client,d.priceFeed,n,'fetchPrice'),read<bigint>(client,d.musd,n,'balanceOf',[borrower]),client.getBalance({address:borrower,blockNumber:n}),read<number>(client,d.musd,n,'decimals')]);
 if(decimals!==18||price<=0n||!statuses[statusCode]||entire.length!==6)throw new Error('Invalid protocol snapshot');
 const [icr,recoveryMode]=await Promise.all([read<bigint>(client,d.troveManager,n,'getCurrentICR',[borrower,price]),read<boolean>(client,d.troveManager,n,'checkRecoveryMode',[price])]);
 await canonical(client,n,block.hash);
 const timestamp=Number(block.timestamp);if(!Number.isSafeInteger(timestamp)||timestamp<0)throw new Error('Invalid block timestamp');
 return {chainId:31611,sourceCommit:d.sourceCommit,borrower,blockNumber:n.toString(),blockHash:block.hash,blockTimestamp:timestamp,statusCode,status:statuses[statusCode]!,collateralBaseUnits:entire[0]!.toString(),principalBaseUnits:entire[1]!.toString(),interestBaseUnits:entire[2]!.toString(),debtBaseUnits:(entire[1]!+entire[2]!).toString(),pendingCollateralBaseUnits:entire[3]!.toString(),pendingPrincipalBaseUnits:entire[4]!.toString(),pendingInterestBaseUnits:entire[5]!.toString(),priceBaseUnits:price.toString(),icrBaseUnits:icr.toString(),minimumCollateralRatioBaseUnits:mcr.toString(),criticalCollateralRatioBaseUnits:ccr.toString(),recoveryMode,minNetDebtBaseUnits:minDebt.toString(),gasCompensationBaseUnits:gasComp.toString(),troveInterestRateBps:troveRate,currentInterestRateBps:currentRate,ownerMusdBalanceBaseUnits:balance.toString(),ownerGasBalanceBaseUnits:gas.toString(),codeHashes};
}
