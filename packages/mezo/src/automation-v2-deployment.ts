import {encodeDeployData,getAddress,isAddress,zeroAddress,type Address,type Hex} from 'viem';
import {automationV2Artifact} from './automation-v2-artifact';
import {troveDeployment} from './trove-read';
import {parseMusd} from '../../domain/src/money';
export function automationV2DeploymentData(owner:string,budget:string):Hex {
 if(!isAddress(owner)||getAddress(owner)===zeroAddress)throw Error('A valid owner wallet is required.');
 const cap=parseMusd(budget);if(cap===0n)throw Error('Choose a positive spending budget.');
 return encodeDeployData({abi:automationV2Artifact.abi,bytecode:automationV2Artifact.bytecode as Hex,args:[troveDeployment.musd,getAddress(owner),cap,troveDeployment.borrowerOperations,troveDeployment.troveManager]});
}
