import {timingSafeEqual} from 'node:crypto';
export function authorizedScheduler(header:string|null,secret:string|undefined){
 if(!secret||secret.length<32||!header?.startsWith('Bearer '))return false;
 const supplied=Buffer.from(header.slice(7)),expected=Buffer.from(secret);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
