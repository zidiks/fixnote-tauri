import { AnimatePresence, motion } from 'framer-motion';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AIChat, type AiProposal } from './components/AIChat';
import { SpatialHome } from './components/SpatialHome';
import type { WorkspaceResource, WorkspaceSnapshot } from './domain';
import {
  createResource,
  createFolder,
  deleteFolder,
  deleteResource,
  loadWorkspace,
  saveWorkspace,
  signOut,
  updateFolder,
  updateResource,
} from './lib/api';

type Screen =
  | { kind: 'home' }
  | { kind: 'resource'; resourceId: string };

const NoteEditor = lazy(() =>
  import('./components/NoteEditor').then((module) => ({
    default: module.NoteEditor,
  })),
);

const BoardEditor = lazy(() =>
  import('./components/BoardEditor').then((module) => ({
    default: module.BoardEditor,
  })),
);

export function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>({
    folders: [],
    resources: [],
  });
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    void loadWorkspace().then((next) => {
      setSnapshot(next);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading) void saveWorkspace(snapshot);
  }, [loading, snapshot]);

  const activeResource = useMemo(
    () =>
      screen.kind === 'resource'
        ? snapshot.resources.find(
            (resource) => resource.id === screen.resourceId,
          )
        : undefined,
    [screen, snapshot.resources],
  );

  async function addResource(
    kind: WorkspaceResource['kind'],
    title = kind === 'note' ? 'Untitled note' : 'Untitled board',
  ) {
    const resource = await createResource(
      {
        kind,
        title,
        position: {
          x: 280 + (snapshot.resources.length % 3) * 360,
          y: 180 + Math.floor(snapshot.resources.length / 3) * 260,
        },
      },
      snapshot,
    );
    setSnapshot((current) => ({
      ...current,
      resources: [...current.resources, resource],
    }));
    return resource;
  }

  async function patchResource(
    resourceId: string,
    patch: Parameters<typeof updateResource>[1],
  ) {
    const current = snapshot.resources.find(
      (resource) => resource.id === resourceId,
    );
    if (!current) return;
    const updated = await updateResource(current, patch);
    setSnapshot((state) => ({
      ...state,
      resources: state.resources.map((resource) =>
        resource.id === resourceId ? updated : resource,
      ),
    }));
  }

  async function removeResource(resourceId: string) {
    const current = snapshot.resources.find(
      (resource) => resource.id === resourceId,
    );
    if (!current) return;
    await deleteResource(current, snapshot);
    setSnapshot((state) => ({
      ...state,
      resources: state.resources.filter((resource) => resource.id !== resourceId),
    }));
    if (screen.kind === 'resource' && screen.resourceId === resourceId) {
      setScreen({ kind: 'home' });
    }
  }

  async function renameFolder(folderId: string, name: string) {
    const current = snapshot.folders.find((folder) => folder.id === folderId);
    if (!current) return;
    const updated = await updateFolder(current, { name });
    setSnapshot((state) => ({
      ...state,
      folders: state.folders.map((folder) =>
        folder.id === folderId ? updated : folder,
      ),
    }));
  }

  async function moveFolder(folderId: string, parentId: string | null, position: { x: number; y: number }) {
    const current = snapshot.folders.find((folder) => folder.id === folderId);
    if (!current) return;
    const updated = await updateFolder(current, { parentId, position });
    setSnapshot((state) => ({
      ...state,
      folders: state.folders.map((folder) =>
        folder.id === folderId ? updated : folder,
      ),
    }));
  }

  async function addFolder(name: string, parentId: string | null, position: { x: number; y: number }) {
    const folder = await createFolder({ name, parentId, position }, snapshot);
    setSnapshot((state) => ({ ...state, folders: [...state.folders, folder] }));
  }

  async function removeFolder(folderId: string) {
    await deleteFolder(folderId, snapshot);
    setSnapshot((state) => ({
      folders: state.folders.filter((folder) => folder.id !== folderId),
      resources: state.resources.map((resource) =>
        resource.folderId === folderId ? { ...resource, folderId: null } : resource,
      ),
    }));
  }

  async function applyAiProposal(proposal: AiProposal) {
    if (proposal.type === 'create_note') {
      const created = await addResource('note', proposal.title);
      setScreen({ kind: 'resource', resourceId: created.id });
      return;
    }
    if (proposal.type === 'rename' && activeResource) {
      await patchResource(activeResource.id, { title: proposal.title });
    }
  }

  return (
    <div className="app-frame">
      <motion.main
        className="app-content"
      >
        <AnimatePresence mode="wait">
          {screen.kind === 'home' || !activeResource ? (
            <motion.div
              key="home"
              className="screen-layer"
              initial={{ opacity: 0, scale: 0.992 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.008 }}
            >
              <SpatialHome
                loading={loading}
                folders={snapshot.folders}
                resources={snapshot.resources}
                onOpen={(resourceId) =>
                  setScreen({ kind: 'resource', resourceId })
                }
                onCreate={addResource}
                onCreateFolder={addFolder}
                onPatch={patchResource}
                onDelete={removeResource}
                onRenameFolder={renameFolder}
                onDeleteFolder={removeFolder}
                onMoveFolder={moveFolder}
                onOpenChat={() => setChatOpen(true)}
                onSignOut={signOut}
              />
            </motion.div>
          ) : activeResource.kind === 'note' ? (
            <motion.div
              key={activeResource.id}
              className="screen-layer"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
            >
              <Suspense fallback={<ResourceLoading />}>
                <NoteEditor
                  resource={activeResource}
                  onBack={() => setScreen({ kind: 'home' })}
                  onRename={(title) =>
                    patchResource(activeResource.id, { title })
                  }
                  onOpenChat={() => setChatOpen(true)}
                />
              </Suspense>
            </motion.div>
          ) : (
            <motion.div
              key={activeResource.id}
              className="screen-layer"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
            >
              <Suspense fallback={<ResourceLoading />}>
                <BoardEditor
                  resource={activeResource}
                  onBack={() => setScreen({ kind: 'home' })}
                  onOpenChat={() => setChatOpen(true)}
                />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.main>

      <AIChat
        open={chatOpen}
        scope={activeResource ?? null}
        resources={snapshot.resources}
        onOpenChange={setChatOpen}
        onOpenResource={(resourceId) =>
          setScreen({ kind: 'resource', resourceId })
        }
        onApplyProposal={applyAiProposal}
      />
    </div>
  );
}

function ResourceLoading() {
  return (
    <div className="resource-loading">
      <span />
      Opening local document…
    </div>
  );
}
