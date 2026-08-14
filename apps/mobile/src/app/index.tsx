import { ConnectionScreen } from '@/screens/ConnectionScreen';
import { LoadingScreen } from '@/screens/LoadingScreen';
import { SessionListScreen } from '@/screens/SessionListScreen';
import { useConnection } from '@/state/connection-store';

export default function IndexRoute() {
  const connection = useConnection();
  if (connection.phase === 'hydrating') return <LoadingScreen />;
  if (!connection.token || connection.phase === 'unpaired' || connection.phase === 'pairing') {
    return <ConnectionScreen />;
  }
  return <SessionListScreen />;
}
