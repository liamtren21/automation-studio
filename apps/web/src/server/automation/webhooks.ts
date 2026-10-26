import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import https from 'node:https';
const denied=new BlockList();
for(const [network,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)denied.addSubnet(network,prefix,'ipv4');
denied.addSubnet('2001:db8::',32,'ipv6');
denied.addSubnet('2001::',32,'ipv6'); // Teredo can encapsulate a private target.
denied.addSubnet('2002::',16,'ipv6'); // 6to4 can encapsulate a private target.
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
export type DnsResolver=(host:string)=>Promise<{address:string;family:number}[]>;
function publicAddress(address:string,family:number){return family===4?isIP(address)===4&&!denied.check(address,'ipv4'):family===6&&isIP(address)===6&&globalV6.check(address,'ipv6')&&!denied.check(address,'ipv6');}
export async function assertPublicWebhookUrl(value:string,resolver:DnsResolver=host=>lookup(host,{all:true,verbatim:true})) {
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||value.length>2000)throw new Error('Use a public HTTPS webhook URL on port 443, without credentials or fragments.');
 const hostname=url.hostname.replace(/^\[|\]$/g,'');
 if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local'))throw new Error('Webhook destination must be public.');
 let timer:ReturnType<typeof setTimeout>|undefined;
 const family=isIP(hostname);let addresses:{address:string;family:number}[];
 try{addresses=family?[{address:hostname,family}]:await Promise.race([resolver(hostname),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Webhook DNS lookup timed out.')),4000);})]);}finally{if(timer)clearTimeout(timer);}
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address,a.family)))throw new Error('Webhook destination must resolve only to public addresses.');
 return {url,target:addresses[0]!};
}
function encryptionKey(value:string){if(!/^[0-9a-f]{64}$/i.test(value))throw new Error('Webhook encryption is not configured.');return Buffer.from(value,'hex');}
export function protectWebhookSecret(secret:string,key:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(key),iv),body=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),body].map(b=>b.toString('hex')).join('.');}
export function unprotectWebhookSecret(encoded:string,key:string){const [iv,tag,body]=encoded.split('.');if(!iv||!tag||!body)throw new Error('Invalid encrypted webhook secret.');const cipher=createDecipheriv('aes-256-gcm',encryptionKey(key),Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([cipher.update(Buffer.from(body,'hex')),cipher.final()]).toString('utf8');}
export const webhookSignature=(secret:string,timestamp:string,raw:string)=>'v1='+createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
export function verifyWebhookSignature(secret:string,timestamp:string,raw:string,signature:string,now=Math.floor(Date.now()/1000)) {
 if(!/^\d+$/.test(timestamp)||Math.abs(now-Number(timestamp))>300||!/^v1=[0-9a-f]{64}$/.test(signature))return false;
 return timingSafeEqual(Buffer.from(webhookSignature(secret,timestamp,raw)),Buffer.from(signature));
}
/** Resolve afresh per attempt, then pin the approved IP at the actual TLS connection. No redirects. */
export async function postWebhook(url:string,body:string,headers:Record<string,string>,ports:{resolver?:DnsResolver;request?:typeof https.request}={}):Promise<{status:number}> {
 const destination=await assertPublicWebhookUrl(url,ports.resolver);
 return new Promise((resolve,reject)=>{
  let deadline:ReturnType<typeof setTimeout>|undefined;
  const finish=(error:Error|null,status?:number)=>{if(deadline)clearTimeout(deadline);error?reject(error):resolve({status:status??0});};
  const request=(ports.request??https.request)(destination.url,{method:'POST',agent:false,headers:{...headers,'content-type':'application/json','content-length':String(Buffer.byteLength(body))},
   lookup:(_host,_options,callback)=>{callback(null,[{address:destination.target.address,family:destination.target.family as 4|6}]);}},response=>{
    const status=response.statusCode??0;response.destroy();finish(null,status);
   });
  deadline=setTimeout(()=>{request.destroy(new Error('Webhook deadline exceeded.'));finish(new Error('Webhook delivery timed out.'));},8000);
  request.setTimeout(8000,()=>request.destroy(new Error('Webhook request timed out.')));request.on('error',()=>finish(new Error('Webhook delivery failed.')));request.end(body);
 });
}
