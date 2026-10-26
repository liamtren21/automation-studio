import {afterEach,expect,it,vi} from 'vitest';
import type {Database} from '../packages/db/src/database';
import {automationTick} from '../apps/worker/src/automation/runtime';
afterEach(()=>vi.unstubAllEnvs());
it('never enables execution from the old application flag or signer',async()=>{
 vi.stubEnv('MEZORA_AUTOMATION_EXECUTION','true');vi.stubEnv('MEZORA_EXECUTOR_PRIVATE_KEY','0x'+'11'.repeat(32));vi.stubEnv('STUDIO_AUTOMATION_EXECUTION','');
 const query=vi.fn(()=>{throw new Error('Database must not be touched');});await automationTick({query} as unknown as Database,'worker');expect(query).not.toHaveBeenCalled();
});
it('requires the standalone signer even when the old signer is configured',async()=>{
 vi.stubEnv('STUDIO_AUTOMATION_EXECUTION','true');vi.stubEnv('DATABASE_URL','postgres://studio-test');vi.stubEnv('STUDIO_EXECUTOR_PRIVATE_KEY','');vi.stubEnv('MEZORA_EXECUTOR_PRIVATE_KEY','0x'+'11'.repeat(32));
 await expect(automationTick({} as Database,'worker')).rejects.toThrow('dedicated restricted executor signer');
});
