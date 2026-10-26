import { AutomationStudio } from '@/features/automation/studio';
import './automation.css';

export default async function AutomationPage({searchParams}: {searchParams: Promise<{mode?: string}>}) {
  const {mode} = await searchParams;
  return <AutomationStudio mode={mode === 'live' ? 'live' : 'demo'}/>;
}
