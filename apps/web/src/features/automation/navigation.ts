export type SettingsSection='funds'|'permissions'|'service'|'records'|'integrations';
export type StudioRoute={tab:'overview'|'payments'|'cash'|'settings'|'runs';section?:SettingsSection;anchor?:string;botId?:string};
export function studioRoute(hash:string):StudioRoute{
 if(hash==='group-payments')return {tab:'payments',anchor:'group-payments'};
 if(hash==='new-bot')return {tab:'payments',anchor:'new-payment'};
 if(/^bot-0x[0-9a-f]{64}$/i.test(hash))return {tab:'payments',botId:hash.slice(4),anchor:'new-payment'};
 if(hash==='permissions')return {tab:'settings',section:'permissions',anchor:'permissions'};
 if(['runtime','service'].includes(hash))return {tab:'settings',section:'service',anchor:'runtime'};
 if(hash.startsWith('trove-watch-')||['operations','obligations','records','trove','trove-monitor'].includes(hash))return {tab:'settings',section:'records',anchor:hash==='records'?'operations':hash};
 if(hash==='integrations')return {tab:'settings',section:'integrations',anchor:hash};
 if(['funds','protection','wallet'].includes(hash))return {tab:'settings',section:'funds',anchor:hash};
 if(['allocation-plan','forecast','repayment','cash'].includes(hash))return {tab:'cash',anchor:hash==='cash'?'forecast':hash};
 if(['my-bots','payments'].includes(hash))return {tab:'payments',anchor:'schedules'};
 if(['activity','runs'].includes(hash))return {tab:'runs',anchor:'activity'};
 if(hash==='settings')return {tab:'settings',section:'funds',anchor:'funds'};
 return {tab:'overview'};
}
export interface UnsignedDraft {template:'recurring'|'once';name:string;recipient:string;amount:string;budget:string;interval:string;start:string;end:string;priority:string;formStep:1|2}
export const draftStorageKey=(mode:string,owner:string)=>`automation-studio:draft:${mode}:${owner.toLowerCase()}`;
export function readUnsignedDraft(raw:string|null):UnsignedDraft|null{try{if(!raw||raw.length>5000)return null;const v=JSON.parse(raw);if(!['recurring','once'].includes(v.template)||!['name','recipient','amount','budget','interval','start','end','priority'].every(key=>typeof v[key]==='string'&&v[key].length<=200))return null;return {template:v.template,name:v.name,recipient:v.recipient,amount:v.amount,budget:v.budget,interval:v.interval,start:v.start,end:v.end,priority:v.priority,formStep:v.formStep===2?2:1};}catch{return null;}}
