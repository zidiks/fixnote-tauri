import { HocuspocusProvider } from '@hocuspocus/provider';
import { roomNames } from '@fixnote/sync';
import { useEffect, useMemo, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { getRealtimeToken } from './api';

export type ConnectionState = 'offline' | 'connecting' | 'online';

export function useCollaboration(resourceId: string) {
  const document = useMemo(() => new Y.Doc(), [resourceId]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<ConnectionState>('offline');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const name = roomNames.resource(resourceId);
    const persistence = new IndexeddbPersistence(name, document);
    setHydrated(false);
    persistence.once('synced', () => setHydrated(true));
    let activeProvider: HocuspocusProvider | null = null;
    let disposed = false;

    void getRealtimeToken().then((token) => {
      if (disposed || !import.meta.env.VITE_REALTIME_URL) return;
      setStatus('connecting');
      activeProvider = new HocuspocusProvider({
        url: import.meta.env.VITE_REALTIME_URL,
        name,
        document,
        token,
      });
      activeProvider.on('status', ({ status: nextStatus }: { status: string }) => {
        setStatus(nextStatus === 'connected' ? 'online' : 'connecting');
      });
      activeProvider.on('disconnect', () => setStatus('offline'));
      setProvider(activeProvider);
    });

    return () => {
      disposed = true;
      activeProvider?.destroy();
      persistence.destroy();
    };
  }, [document, resourceId]);

  return { document, provider, status, hydrated };
}
