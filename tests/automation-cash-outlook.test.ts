import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {AutomationCashOutlook} from '../apps/web/src/features/automation/cash-outlook';
import type {StudioView} from '../apps/web/src/features/automation/studio';
import {forecastPortfolio,type PortfolioAccount} from '../packages/automation/src/studio/portfolio';
const account:PortfolioAccount={now:'1793000000',balance:'2000000000000000000',committedBills:'0',buffer:'0',globalBudget:'0',globalSpent:'0',protectionSourceHash:`0x${'4'.repeat(64)}`,protectionExpiresAt:'1794000000',allocations:{},spent:{},consumed:{}};
it('renders negative hypothetical cash as an uncovered expense instead of crashing the cash tab',()=>{
 const portfolio=forecastPortfolio(account,[],30,{repaymentExpense:'5000000000000000000'});
 const address='0x1111111111111111111111111111111111111111' as const;
 const view:StudioView={account:{...account,mode:'demo',vault:address,owner:address,token:address,protectionSourceHash:`0x${'4'.repeat(64)}`,labels:{},activity:[]},portfolio,rules:[],activity:[],mode:'demo',configured:true,notice:''};
 const html=renderToStaticMarkup(createElement(AutomationCashOutlook,{view,mode:'demo'}));
 expect(html).toContain('-3.00');expect(html).toContain('No transaction is sent');
});
