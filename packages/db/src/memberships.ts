import type {Sql} from './database';
export type Role='owner';
export async function requireRole(_q:Sql,namespace:string,actor:string,allowed:Role[]){
 if(!allowed.includes('owner')||!(namespace.startsWith('demo:')&&actor==='scenario'||namespace==='live:'+actor.toLowerCase()))throw Object.assign(new Error('Account permission denied.'),{status:403});
 return 'owner' as const;
}
