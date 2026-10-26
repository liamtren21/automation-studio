import {integer,type StudioPolicy} from './types';
import {validatePolicy} from './policy';
/** Returns current period only; endAt is exclusive and missed periods are never charged. */
export function periodAt(policy:StudioPolicy,now:string):string|null {validatePolicy(policy);const n=integer(now),start=integer(policy.startAt);return n<start||n>=integer(policy.endAt)?null:((n-start)/integer(policy.intervalSeconds)).toString();}
export function nextPeriodAt(policy:StudioPolicy,now:string):string|null {const n=integer(now),start=integer(policy.startAt),end=integer(policy.endAt);if(n<start)return start.toString();if(n>=end)return null;const next=start+((n-start)/integer(policy.intervalSeconds)+1n)*integer(policy.intervalSeconds);return next<end?next.toString():null;}
