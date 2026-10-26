'use client';
import {useState} from 'react';
import {useOkxProvider} from '../../components/okx-provider';
import {ensureSetupChain,setupWalletError,type SetupProvider} from '../../components/setup-wallet';
import {officialTestnetMusd} from '../../../../../packages/mezo/src/network';

export async function addMusdToWallet(provider:SetupProvider){
 await ensureSetupChain(provider);
 return await provider.request({method:'wallet_watchAsset',params:{type:'ERC20',options:{address:officialTestnetMusd,symbol:'MUSD',decimals:18}}})===true;
}
export function AddMusdToken(){
 const provider=useOkxProvider(),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 async function add(){setBusy(true);setNotice('');setError('');try{
  if(!provider)throw new Error('Enable the OKX Wallet extension to add MUSD.');
  const added=await addMusdToWallet(provider);
  setNotice(added?'MUSD added to your wallet on Mezo Testnet. Your token balance has not changed.':'MUSD was not added. You can retry or import the token address below in OKX.');
 }catch(cause){setError(setupWalletError(cause,'Adding MUSD')+' You can also import the token address below manually in OKX.');}finally{setBusy(false);}}
 return <section className="as-card" aria-label="MUSD wallet token"><div className="as-section-head"><div><h3>See MUSD in your wallet</h3><p>Add the Mezo Testnet token to OKX. This displays the token; it does not give you MUSD or move funds.</p></div><button className="as-button" disabled={busy} onClick={()=>void add()}>{busy?'Check OKX…':'Add MUSD to OKX'}</button></div><details><summary>Token details / manual import</summary><p>Mezo Testnet · Chain 31611 · MUSD · 18 decimals</p><p className="as-address">{officialTestnetMusd}</p></details>{busy&&<p role="status">Review the network or token request in OKX.</p>}{notice&&<p role="status" className="as-success">{notice}</p>}{error&&<p role="alert" className="as-error">{error}</p>}</section>;
}
