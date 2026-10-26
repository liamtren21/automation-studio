import {it,expect} from 'vitest';
import {studioRoute,readUnsignedDraft,draftStorageKey} from '../apps/web/src/features/automation/navigation';
it('maps old deep links to exactly one Settings section and its eventual anchor',()=>{
 expect(studioRoute('runtime')).toEqual({tab:'settings',section:'service',anchor:'runtime'});
 expect(studioRoute('trove-watch-12')).toEqual({tab:'settings',section:'records',anchor:'trove-watch-12'});
 expect(studioRoute('permissions')).toEqual({tab:'settings',section:'permissions',anchor:'permissions'});
 expect(studioRoute('repayment')).toEqual({tab:'cash',anchor:'repayment'});
});
it('restores only unsigned input values and scopes storage to mode and owner',()=>{
 expect(draftStorageKey('live','0xABC')).toBe(draftStorageKey('live','0xabc'));
 expect(draftStorageKey('demo','0xabc')).not.toBe(draftStorageKey('live','0xabc'));
 const value={template:'recurring',name:'Rent',recipient:'0x123',amount:'0.000000000000000001',budget:'1',interval:'604800',start:'2026-10-26T12:00',end:'2026-11-01T12:00',priority:'1',formStep:2,accepted:true};
 expect(readUnsignedDraft(JSON.stringify(value))).not.toHaveProperty('accepted');
 expect(readUnsignedDraft(JSON.stringify(value))?.amount).toBe(value.amount);
 expect(readUnsignedDraft('{bad')).toBeNull();
});
