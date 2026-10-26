import {it,expect} from 'vitest';
import {botPresentation} from '../apps/web/src/features/automation/bot-presentation';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BotCard} from '../apps/web/src/features/automation/bot-card';
const rule={status:'active',policy:{enabled:true,startAt:'100',endAt:'1000',intervalSeconds:'100',amount:'10000000000000000'},snapshot:{now:'200',consumedPeriods:['1']},decision:{reasonCode:'PERIOD_USED'}} as never;
it('a stopped bot never asks for activation or announces another payment',()=>{
 const info=botPresentation({...rule as any,status:'revoked'});
 expect(info.status).toBe('Stopped');expect(info.nextAt).toBeNull();expect(info.message).not.toMatch(/activat|permission|next window/i);
});
it('a completed schedule has no next payment',()=>{
 const info=botPresentation({...rule as any,snapshot:{now:'1001',consumedPeriods:[]}});
 expect(info.status).toBe('Ended');expect(info.nextAt).toBeNull();
});
it('a paid period points to the next unpaid date without technical wording',()=>{
 const info=botPresentation(rule);expect(info.nextAt).toBe('300');expect(info.status).toBe('Scheduled');
 expect(info.message).not.toMatch(/policy|period|onchain/i);
});
it('a draft offers setup rather than claiming payments are scheduled',()=>{
 const info=botPresentation({...rule as any,status:'draft'});expect(info.status).toBe('Draft');expect(info.nextAt).toBeNull();
});
it('does not announce another payment after the final allowed payout',()=>{
 const info=botPresentation({...rule as any,policy:{...(rule as any).policy,lifetimeCap:'20000000000000000'},snapshot:{...(rule as any).snapshot,lifetimeSpent:'20000000000000000'}});
 expect(info.status).toBe('Budget reached');expect(info.nextAt).toBeNull();
});
it('a stopped card shows the business outcome without technical fields or restart controls',()=>{
 const stopped={...rule as any,status:'revoked',name:'Supplier payment',policy:{...(rule as any).policy,recipient:'0x2222222222222222222222222222222222222222',policyId:'0x01'}};
 const html=renderToStaticMarkup(createElement(BotCard,{rule:stopped,onOpen:()=>{},onStop:()=>{},busy:false}));
 expect(html).toContain('Stopped');expect(html).toContain('No more payments');
 expect(html).not.toMatch(/Policy|Priority|Chain|Version|Waiting for permission|Next payment|Continue setup|Stop payments/);
});
