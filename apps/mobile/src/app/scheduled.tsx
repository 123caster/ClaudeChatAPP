import { ConnectionScreen } from '@/screens/ConnectionScreen';
import { LoadingScreen } from '@/screens/LoadingScreen';
import { ScheduledTaskListScreen } from '@/screens/ScheduledTaskListScreen';
import { useConnection } from '@/state/connection-store';

export default function ScheduledRoute() {
  const connection = useConnection();
  if (connection.phase === 'hydrating') return <LoadingScreen />;
  if (!connection.deviceToken || connection.phase === 'unpaired') return <ConnectionScreen />;
  return <ScheduledTaskListScreen />;
}
