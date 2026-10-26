import {createPublicClient,http,defineChain} from 'viem';
export const officialTestnetMusd='0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503' as const;
export const mezoTestnet=defineChain({id:31611,name:'Mezo Testnet',nativeCurrency:{name:'Bitcoin',symbol:'BTC',decimals:18},rpcUrls:{default:{http:['https://rpc.test.mezo.org']}},blockExplorers:{default:{name:'Mezo Explorer',url:'https://explorer.test.mezo.org'}}});
export const publicClient=()=>createPublicClient({chain:mezoTestnet,transport:http(process.env.MEZO_RPC_URL||mezoTestnet.rpcUrls.default.http[0],{timeout:10000,retryCount:1})});
