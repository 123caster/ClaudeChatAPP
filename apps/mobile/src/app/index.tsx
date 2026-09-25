import { ConnectionScreen } from '@/screens/ConnectionScreen';
import { LoadingScreen } from '@/screens/LoadingScreen';
import { SessionListScreen } from '@/screens/SessionListScreen';
import { useConnection } from '@/state/connection-store';

export default function IndexRoute() {
  const connection = useConnection();
  if (connection.phase === 'hydrating') return <LoadingScreen />;
  if (
    !connection.deviceToken ||
    connection.phase === 'unpaired' ||
    connection.phase === 'connecting'
  ) {
    return <ConnectionScreen />;
  }
  return <SessionListScreen />;
}
