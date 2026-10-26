import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SetupGuide,VersionComparison,VersionHistory} from '../apps/web/src/features/automation/task-guide';
import {RunReceipt} from '../apps/web/src/features/automation/run-receipt';
import {OperationsPanel} from '../apps/web/src/features/automation/operations-panel';
import {ScenarioLibrary} from '../apps/web/src/features/automation/scenario-library';
import {WebhookSettings} from '../apps/web/src/features/automation/webhook-settings';
it('makes notification endpoint disclosure explicit and does not offer payment retries',()=>{
 const markup=renderToStaticMarkup(createElement(WebhookSettings));
 expect(markup).toContain('HTTPS endpoint');expect(markup).toContain('payment details');expect(markup).toContain('never resends a payment');
});
it('labels teaching examples as simulated and exposes only one selected example',()=>{
 const markup=renderToStaticMarkup(createElement(ScenarioLibrary));
 expect(markup).toContain('Simulated examples');expect(markup).toContain('Two bots, one cash balance');expect(markup).toContain('No account changes');
 expect((markup.match(/aria-pressed="true"/g)||[])).toHaveLength(1);
});
it('offers human units for advanced recovery and alert cooldown',()=>{
 const markup=renderToStaticMarkup(createElement(OperationsPanel,{mode:'demo'}));
 expect(markup).toContain('Recover above collateral ratio (%)');expect(markup).toContain('Alert cooldown (minutes)');
});
it('asks for consent before creating a public receipt',()=>{
 const markup=renderToStaticMarkup(createElement(RunReceipt,{runId:'run-1'}));
 expect(markup).toContain('recipient');expect(markup).toContain('policy version');expect(markup).toContain('disabled');expect(markup).toContain('anyone with the link');
});
it('renders missing account guidance without a ready claim or wallet request',()=>{
 const markup=renderToStaticMarkup(createElement(SetupGuide,{view:{mode:'live',configured:false,account:null,rules:[],activity:[],notice:''},onNavigate:()=>{}}));
 expect(markup).toContain('requires an account before saving a draft');
 expect(markup).toContain('Unknown');
 expect(markup).not.toContain('Everything is ready');
});
it('renders changed permission fields before and after',()=>{
 const markup=renderToStaticMarkup(createElement(VersionComparison,{before:{endAt:'100',version:'1'} as never,after:{endAt:'200',version:'2'} as never}));
 expect(markup).toContain('Version 1');expect(markup).toContain('Version 2');expect(markup).toContain('Schedule ends');
});
it('shows every saved version with exact human token units and readable frequency',()=>{
 const policy={amount:'1',lifetimeCap:'1000000000000000000',intervalSeconds:'604800',startAt:'100',endAt:'200',version:'1'};
 const html=renderToStaticMarkup(createElement(VersionHistory,{rule:{policy,revisions:[{version:'1',policy},{version:'2',policy:{...policy,version:'2'}}],onchainVersion:'1'} as never}));
 expect(html).toContain('0.000000000000000001 MUSD');expect(html).toContain('Every 7 days');expect(html).toContain('Version 1');expect(html).toContain('Version 2');expect(html).toContain('Current confirmed onchain version: 1');
});
