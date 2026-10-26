import { AutomationStudio } from '@/features/automation/studio';
import './automation/automation.css';

export default async function Page({searchParams}: {searchParams: Promise<{mode?: string}>}) {
  const {mode} = await searchParams;
  return <AutomationStudio mode={mode === 'live' ? 'live' : 'demo'}/>;
}
