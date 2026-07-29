import { AnimatePresence, motion } from 'framer-motion';
import type { FolderSummary } from '@fixnote/contracts';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AIChat, type AiProposal } from './components/AIChat';
import { PersistentYoutubePlayer } from './components/PersistentYoutubePlayer';
import { SpatialHome } from './components/SpatialHome';
import type {
  ImportCandidate,
  WorkspaceResource,
  WorkspaceSnapshot,
  YoutubePlayback,
} from './domain';
import {
  createResource,
  createFolder,
  deleteImportedAsset,
  deleteFolder,
  deleteResource,
  loadWorkspace,
  saveWorkspace,
  saveImportedAsset,
  signOut,
  updateFolder,
  updateResource,
} from './lib/api';
import { prepareImport } from './lib/imports';
import { loadLinkPreview } from './lib/link-preview';

type Screen =
  | { kind: 'home'; folderId: string | null }
  | {
      kind: 'resource';
      resourceId: string;
      returnFolderId: string | null;
    };

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
  const [screen, setScreen] = useState<Screen>({
    kind: 'home',
    folderId: null,
  });
  const [chatOpen, setChatOpen] = useState(false);
  const [youtubePlayback, setYoutubePlayback] =
    useState<YoutubePlayback | null>(null);

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
  const homeFolderId =
    screen.kind === 'home' ? screen.folderId : screen.returnFolderId;

  async function addResource(
    kind: WorkspaceResource['kind'],
    title = kind === 'note' ? 'Untitled note' : 'Untitled board',
    folderId: string | null = null,
    position?: WorkspaceResource['position'],
  ) {
    const siblingCount = snapshot.resources.filter(
      (resource) => resource.folderId === folderId,
    ).length;
    const resource = await createResource(
      {
        kind,
        title,
        folderId,
        position:
          position ?? {
            x: 280 + (siblingCount % 3) * 360,
            y: 180 + Math.floor(siblingCount / 3) * 260,
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
    if (current.imported?.kind === 'file') {
      await deleteImportedAsset(current.imported.assetId);
    }
    await deleteResource(current, snapshot);
    setSnapshot((state) => ({
      ...state,
      resources: state.resources.filter((resource) => resource.id !== resourceId),
    }));
    setYoutubePlayback((current) =>
      current?.resourceId === resourceId ? null : current,
    );
    if (screen.kind === 'resource' && screen.resourceId === resourceId) {
      setScreen({ kind: 'home', folderId: screen.returnFolderId });
    }
  }

  async function importCandidates(
    candidates: ImportCandidate[],
    position: { x: number; y: number },
    folderId: string | null,
  ) {
    const prepared = await Promise.all(
      candidates.map((candidate) =>
        prepareImport(candidate, loadLinkPreview),
      ),
    );
    const importedResources: WorkspaceResource[] = [];
    let workingSnapshot = snapshot;

    for (const [index, item] of prepared.entries()) {
      if (item.file && item.imported.kind === 'file') {
        await saveImportedAsset(item.imported.assetId, item.file);
      }
      const resource = await createResource(
        {
          kind: 'note',
          title: item.title,
          folderId,
          position: {
            x: position.x + (index % 3) * 42,
            y: position.y + Math.floor(index / 3) * 42,
          },
          size: item.size,
        },
        workingSnapshot,
      );
      const importedResource: WorkspaceResource = {
        ...resource,
        imported: item.imported,
        preview: item.preview,
        accent: item.accent,
      };
      importedResources.push(importedResource);
      workingSnapshot = {
        ...workingSnapshot,
        resources: [...workingSnapshot.resources, importedResource],
      };
    }

    setSnapshot((current) => ({
      ...current,
      resources: [...current.resources, ...importedResources],
    }));
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

  async function changeFolderColor(
    folderId: string,
    color: FolderSummary['color'],
  ) {
    const current = snapshot.folders.find((folder) => folder.id === folderId);
    if (!current || current.color === color) return;
    const updated = await updateFolder(current, { color });
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
      const created = await addResource(
        'note',
        proposal.title,
        activeResource?.folderId ?? null,
      );
      setScreen({
        kind: 'resource',
        resourceId: created.id,
        returnFolderId: created.folderId,
      });
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
        <AnimatePresence initial={false} mode="wait">
          {screen.kind === 'home' || !activeResource ? (
            <motion.div
              key="home"
              className="screen-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <SpatialHome
                loading={loading}
                folders={snapshot.folders}
                resources={snapshot.resources}
                activeFolder={homeFolderId}
                onActiveFolderChange={(folderId) =>
                  setScreen({ kind: 'home', folderId })
                }
                activeYoutubeResourceId={youtubePlayback?.resourceId ?? null}
                onToggleYoutube={(playback) =>
                  setYoutubePlayback((current) =>
                    current?.resourceId === playback.resourceId
                      ? null
                      : playback,
                  )
                }
                onOpen={(resourceId) =>
                  setScreen({
                    kind: 'resource',
                    resourceId,
                    returnFolderId: homeFolderId,
                  })
                }
                onCreate={addResource}
                onImport={importCandidates}
                onCreateFolder={addFolder}
                onPatch={patchResource}
                onDelete={removeResource}
                onRenameFolder={renameFolder}
                onChangeFolderColor={changeFolderColor}
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <Suspense fallback={<ResourceLoading />}>
                <NoteEditor
                  resource={activeResource}
                  onBack={() =>
                    setScreen({
                      kind: 'home',
                      folderId: screen.returnFolderId,
                    })
                  }
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <Suspense fallback={<ResourceLoading />}>
                <BoardEditor
                  resource={activeResource}
                  onBack={() =>
                    setScreen({
                      kind: 'home',
                      folderId: screen.returnFolderId,
                    })
                  }
                  onOpenChat={() => setChatOpen(true)}
                />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.main>

      <PersistentYoutubePlayer
        playback={youtubePlayback}
        onClose={() => setYoutubePlayback(null)}
      />

      <AIChat
        open={chatOpen}
        scope={activeResource ?? null}
        resources={snapshot.resources}
        onOpenChange={setChatOpen}
        onOpenResource={(resourceId) => {
          const resource = snapshot.resources.find(
            (candidate) => candidate.id === resourceId,
          );
          setScreen({
            kind: 'resource',
            resourceId,
            returnFolderId: resource?.folderId ?? homeFolderId,
          });
        }}
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
