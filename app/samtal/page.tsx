import { redirect } from 'next/navigation';
import Kundstart from '@/components/Kundstart';
import { hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

export const dynamic = 'force-dynamic';

export default async function Samtal() {
  const s = await hamtaSession();
  if ('fel' in s) redirect('/lank?skal=' + (s.fel === 'ingen' ? 'session' : s.fel));
  return <Kundstart start={tillVy(s.a)} />;
}
