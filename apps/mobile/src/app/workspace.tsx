import { Redirect } from 'expo-router';

import { FileTreeScreen } from '@/screens/FileTreeScreen';
import { useConnection } from '@/state/connection-store';

export default function WorkspaceRoute() {
  const connection = useConnection();
  if (!connection.deviceToken) return <Redirect href="/" />;
  return <FileTreeScreen />;
}
