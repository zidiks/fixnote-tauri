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
import { FlowChat } from './components/FlowChat';
import { LibraryView } from './components/LibraryView';
import { PersistentYoutubePlayer } from './components/PersistentYoutubePlayer';
import { SpatialHome } from './components/SpatialHome';
import {
  WorkspaceChrome,
  type CollectionView,
  type LibraryLayout,
  type SidebarMode,
} from './components/WorkspaceChrome';
import type {
  ImportCandidate,
  WorkspaceDropTarget,
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
  | { kind: 'collection'; view: CollectionView }
  | {
      kind: 'resource';
      resourceId: string;
      returnView: CollectionView;
    };

const SPACE_IDS_KEY = 'fixnote:space-resource-ids';
const TRASH_IDS_KEY = 'fixnote:trash-resource-ids';
const LIBRARY_LAYOUT_KEY = 'fixnote:library-layout';
const SIDEBAR_MODE_KEY = 'fixnote:sidebar-mode';

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
    kind: 'collection',
    view: { kind: 'flow' },
  });
  const [chatOpen, setChatOpen] = useState(false);
  const [flowVoiceRequestToken, setFlowVoiceRequestToken] = useState(0);
  const [youtubePlayback, setYoutubePlayback] =
    useState<YoutubePlayback | null>(null);
  const [spaceResourceIds, setSpaceResourceIds] = useState<Set<string>>(
    () => loadIdSet(SPACE_IDS_KEY),
  );
  const [trashResourceIds, setTrashResourceIds] = useState<Set<string>>(
    () => loadIdSet(TRASH_IDS_KEY),
  );
  const [libraryLayout, setLibraryLayout] = useState<LibraryLayout>(
    () =>
      (window.localStorage.getItem(LIBRARY_LAYOUT_KEY) as LibraryLayout) ??
      'grid',
  );
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(
    () =>
      (window.localStorage.getItem(SIDEBAR_MODE_KEY) as SidebarMode) ??
      'fixed',
  );
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [pointerSidebarDropTarget, setPointerSidebarDropTarget] =
    useState<WorkspaceDropTarget | null>(null);

  useEffect(() => {
    void loadWorkspace().then((next) => {
      setSnapshot(next);
      const storedSpaceIds = loadIdSet(SPACE_IDS_KEY);
      const hasExistingSpaceItems = next.resources.some((resource) =>
        storedSpaceIds.has(resource.id),
      );
      // A stale/empty local preference must not make the whole Space look
      // empty after resources have been restored from the workspace.
      if (!hasExistingSpaceItems && next.resources.length) {
        setSpaceResourceIds(new Set(next.resources.map((resource) => resource.id)));
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading) void saveWorkspace(snapshot);
  }, [loading, snapshot]);

  useEffect(() => {
    if (loading) return;
    window.localStorage.setItem(
      SPACE_IDS_KEY,
      JSON.stringify([...spaceResourceIds]),
    );
  }, [loading, spaceResourceIds]);

  useEffect(() => {
    window.localStorage.setItem(
      TRASH_IDS_KEY,
      JSON.stringify([...trashResourceIds]),
    );
  }, [trashResourceIds]);

  useEffect(() => {
    window.localStorage.setItem(LIBRARY_LAYOUT_KEY, libraryLayout);
  }, [libraryLayout]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_MODE_KEY, sidebarMode);
  }, [sidebarMode]);

  const activeResource = useMemo(
    () =>
      screen.kind === 'resource'
        ? snapshot.resources.find(
            (resource) => resource.id === screen.resourceId,
          )
        : undefined,
    [screen, snapshot.resources],
  );
  const activeView =
    screen.kind === 'collection' ? screen.view : screen.returnView;
  const activeFolderId =
    activeView.kind === 'folder' ? activeView.folderId : null;

  function openResource(resourceId: string, returnView = activeView) {
    setOpenTabIds((current) =>
      current.includes(resourceId) ? current : [...current, resourceId],
    );
    setScreen({ kind: 'resource', resourceId, returnView });
  }

  function closeResourceTab(resourceId: string) {
    const tabIndex = openTabIds.indexOf(resourceId);
    const nextTabs = openTabIds.filter((id) => id !== resourceId);
    setOpenTabIds(nextTabs);
    if (screen.kind !== 'resource' || screen.resourceId !== resourceId) return;
    const fallbackId =
      nextTabs[Math.min(Math.max(tabIndex, 0), nextTabs.length - 1)] ??
      nextTabs.at(-1);
    if (fallbackId) {
      setScreen({
        kind: 'resource',
        resourceId: fallbackId,
        returnView: screen.returnView,
      });
    } else {
      setScreen({ kind: 'collection', view: screen.returnView });
    }
  }

  async function addResource(
    kind: WorkspaceResource['kind'],
    title = kind === 'note' ? 'Untitled note' : 'Untitled board',
    folderId: string | null = null,
    position?: WorkspaceResource['position'],
    id?: string,
  ) {
    const siblingCount = snapshot.resources.filter(
      (resource) => resource.folderId === folderId,
    ).length;
    const resource = await createResource(
      {
        ...(id ? { id } : {}),
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
      resources: current.resources.some(
        (candidate) => candidate.id === resource.id,
      )
        ? current.resources.map((candidate) =>
            candidate.id === resource.id ? resource : candidate,
          )
        : [...current.resources, resource],
    }));
    if (activeView.kind === 'space') {
      setSpaceResourceIds((current) => new Set(current).add(resource.id));
    }
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

  function moveResourceToTrash(resourceId: string) {
    setTrashResourceIds((current) => new Set(current).add(resourceId));
    setSpaceResourceIds((current) => {
      const next = new Set(current);
      next.delete(resourceId);
      return next;
    });
    setYoutubePlayback((current) =>
      current?.resourceId === resourceId ? null : current,
    );
    setOpenTabIds((current) => current.filter((id) => id !== resourceId));
    if (screen.kind === 'resource' && screen.resourceId === resourceId) {
      setScreen({ kind: 'collection', view: screen.returnView });
    }
  }

  function restoreResource(resourceId: string) {
    setTrashResourceIds((current) => {
      const next = new Set(current);
      next.delete(resourceId);
      return next;
    });
  }

  async function removeResourcePermanently(resourceId: string) {
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
    setTrashResourceIds((current) => {
      const next = new Set(current);
      next.delete(resourceId);
      return next;
    });
    setSpaceResourceIds((current) => {
      const next = new Set(current);
      next.delete(resourceId);
      return next;
    });
    setYoutubePlayback((current) =>
      current?.resourceId === resourceId ? null : current,
    );
    setOpenTabIds((current) => current.filter((id) => id !== resourceId));
    if (screen.kind === 'resource' && screen.resourceId === resourceId) {
      setScreen({ kind: 'collection', view: screen.returnView });
    }
  }

  async function importCandidates(
    candidates: ImportCandidate[],
    position: { x: number; y: number },
    folderId: string | null,
    pinToSpace = activeView.kind === 'space',
  ): Promise<WorkspaceResource[]> {
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
    if (pinToSpace) {
      setSpaceResourceIds((current) => {
        const next = new Set(current);
        importedResources.forEach((resource) => next.add(resource.id));
        return next;
      });
    }
    return importedResources;
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

  async function removeFolderAndNavigate(folderId: string) {
    await removeFolder(folderId);
    if (activeView.kind === 'folder' && activeView.folderId === folderId) {
      setScreen({ kind: 'collection', view: { kind: 'inbox' } });
    }
  }

  async function applyAiProposal(proposal: AiProposal) {
    if (proposal.type === 'create_note') {
      const created = await addResource(
        'note',
        proposal.title,
        activeResource?.folderId ?? activeFolderId,
        undefined,
        proposal.resourceId ?? undefined,
      );
      openResource(created.id, activeView);
      return;
    }
    if (proposal.type === 'rename_resource' && proposal.resourceId) {
      await patchResource(proposal.resourceId, { title: proposal.title });
    }
  }

  function pinResourceToSpace(resourceId: string) {
    setSpaceResourceIds((current) => new Set(current).add(resourceId));
  }

  function unpinResourceFromSpace(resourceId: string) {
    setSpaceResourceIds((current) => {
      const next = new Set(current);
      next.delete(resourceId);
      return next;
    });
  }

  async function dropResourceIntoSidebar(
    resourceId: string,
    target: WorkspaceDropTarget,
  ) {
    if (target.kind === 'space') {
      pinResourceToSpace(resourceId);
      return;
    }
    await patchResource(resourceId, { folderId: target.folderId });
  }

  async function dropFolderIntoSidebar(
    folderId: string,
    target: WorkspaceDropTarget,
  ) {
    if (target.kind === 'space') {
      const folderIds = new Set<string>([folderId]);
      let changed = true;
      while (changed) {
        changed = false;
        snapshot.folders.forEach((folder) => {
          if (
            folder.parentId &&
            folderIds.has(folder.parentId) &&
            !folderIds.has(folder.id)
          ) {
            folderIds.add(folder.id);
            changed = true;
          }
        });
      }
      setSpaceResourceIds((current) => {
        const next = new Set(current);
        snapshot.resources.forEach((resource) => {
          if (resource.folderId && folderIds.has(resource.folderId)) {
            next.add(resource.id);
          }
        });
        return next;
      });
      return;
    }

    if (
      folderId === target.folderId ||
      isFolderDescendant(target.folderId, folderId, snapshot.folders)
    ) {
      return;
    }
    const folder = snapshot.folders.find((candidate) => candidate.id === folderId);
    if (!folder) return;
    await moveFolder(folderId, target.folderId, folder.position);
  }

  async function importIntoSidebar(
    candidates: ImportCandidate[],
    target: WorkspaceDropTarget,
  ) {
    await importCandidates(
      candidates,
      { x: 240, y: 180 },
      target.kind === 'folder' ? target.folderId : null,
      target.kind === 'space',
    );
  }

  const activeResources = snapshot.resources.filter(
    (resource) => !trashResourceIds.has(resource.id),
  );
  const trashedResources = snapshot.resources.filter((resource) =>
    trashResourceIds.has(resource.id),
  );
  const spaceResources = activeResources.filter((resource) =>
    spaceResourceIds.has(resource.id),
  );
  const libraryResources =
    activeView.kind === 'trash'
      ? trashedResources
      : activeView.kind === 'folder'
        ? activeResources.filter(
            (resource) => resource.folderId === activeView.folderId,
          )
        : activeResources;
  const openTabs = openTabIds.flatMap((resourceId) => {
    const resource = activeResources.find(
      (candidate) => candidate.id === resourceId,
    );
    return resource ? [resource] : [];
  });

  return (
    <div
      className={`app-frame sidebar-${sidebarMode}${screen.kind === 'resource' ? ' is-detail' : ''}${chatOpen ? ' chat-open' : ''}`}
    >
      <WorkspaceChrome
        activeView={activeView}
        folders={snapshot.folders}
        resources={activeResources}
        openTabs={openTabs}
        activeTabId={screen.kind === 'resource' ? screen.resourceId : null}
        libraryLayout={libraryLayout}
        sidebarMode={sidebarMode}
        chatOpen={chatOpen}
        pointerDropTarget={pointerSidebarDropTarget}
        onNavigate={(view) => {
          setScreen({ kind: 'collection', view });
          if (view.kind === 'flow') setChatOpen(false);
        }}
        onSelectTab={(resourceId) => openResource(resourceId, activeView)}
        onCloseTab={closeResourceTab}
        onLibraryLayoutChange={setLibraryLayout}
        onSidebarModeChange={setSidebarMode}
        onDropResource={dropResourceIntoSidebar}
        onDropFolder={dropFolderIntoSidebar}
        onImportToTarget={importIntoSidebar}
        onCreateFolder={(name, parentId) =>
          addFolder(name, parentId, { x: 180, y: 420 })
        }
        onRenameFolder={renameFolder}
        onChangeFolderColor={changeFolderColor}
        onDeleteFolder={removeFolderAndNavigate}
        onToggleChat={() => setChatOpen((current) => !current)}
        onStartVoiceInput={() => {
          setScreen({ kind: 'collection', view: { kind: 'flow' } });
          setChatOpen(false);
          setFlowVoiceRequestToken((current) => current + 1);
        }}
        onSignOut={signOut}
      />

      <motion.main className="app-content">
        <AnimatePresence initial={false} mode="wait">
          {screen.kind === 'collection' && screen.view.kind === 'flow' ? (
            <motion.div
              key="flow"
              className="screen-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <FlowChat
                resources={activeResources}
                voiceRequestToken={flowVoiceRequestToken}
                onOpenResource={(resourceId) => openResource(resourceId, { kind: 'flow' })}
              />
            </motion.div>
          ) : screen.kind === 'collection' && screen.view.kind === 'space' ? (
            <motion.div
              key="space"
              className="screen-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <SpatialHome
                loading={loading}
                folders={snapshot.folders}
                resources={spaceResources}
                activeFolder={null}
                onActiveFolderChange={() => undefined}
                activeYoutubeResourceId={youtubePlayback?.resourceId ?? null}
                onToggleYoutube={(playback) =>
                  setYoutubePlayback((current) =>
                    current?.resourceId === playback.resourceId
                      ? null
                      : playback,
                  )
                }
                onOpen={(resourceId) =>
                  openResource(resourceId, { kind: 'space' })
                }
                onCreate={(kind, title, _folderId, position) =>
                  addResource(kind, title, null, position)
                }
                onImport={(candidates, position) =>
                  importCandidates(candidates, position, null, true).then(
                    () => undefined,
                  )
                }
                onCreateFolder={addFolder}
                onPatch={patchResource}
                onDelete={async (resourceId) =>
                  unpinResourceFromSpace(resourceId)
                }
                onRenameFolder={renameFolder}
                onChangeFolderColor={changeFolderColor}
                onDeleteFolder={removeFolderAndNavigate}
                onMoveFolder={moveFolder}
                onOpenChat={() => setChatOpen(true)}
                onSignOut={signOut}
                showChrome={false}
                showAllResources
                preserveFolderOnMove
                filterQuery=""
                deleteLabel="Remove from Space"
                onSidebarDragTargetChange={setPointerSidebarDropTarget}
                onDropResourceToSidebar={dropResourceIntoSidebar}
              />
            </motion.div>
          ) : screen.kind === 'collection' && screen.view.kind !== 'space' ? (
            <motion.div
              key={
                screen.view.kind === 'folder'
                  ? `folder:${screen.view.folderId}`
                  : screen.view.kind
              }
              className="screen-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <LibraryView
                loading={loading}
                view={screen.view}
                layout={libraryLayout}
                query=""
                resources={libraryResources}
                allResources={activeResources}
                folders={snapshot.folders}
                activeYoutubeResourceId={youtubePlayback?.resourceId ?? null}
                onToggleYoutube={(playback) =>
                  setYoutubePlayback((current) =>
                    current?.resourceId === playback.resourceId
                      ? null
                      : playback,
                  )
                }
                onOpen={(resourceId) => openResource(resourceId, screen.view)}
                onOpenFolder={(folderId) =>
                  setScreen({
                    kind: 'collection',
                    view: { kind: 'folder', folderId },
                  })
                }
                onCreate={(kind) =>
                  addResource(
                    kind,
                    undefined,
                    screen.view.kind === 'folder'
                      ? screen.view.folderId
                      : null,
                  )
                }
                onCreateFolder={(name) =>
                  addFolder(
                    name,
                    screen.view.kind === 'folder'
                      ? screen.view.folderId
                      : null,
                    { x: 180, y: 420 },
                  )
                }
                onRenameFolder={renameFolder}
                onChangeFolderColor={changeFolderColor}
                onDeleteFolder={removeFolder}
                onImport={(candidates) =>
                  importCandidates(
                    candidates,
                    { x: 240, y: 180 },
                    screen.view.kind === 'folder'
                      ? screen.view.folderId
                      : null,
                    false,
                  )
                }
                onPinToSpace={pinResourceToSpace}
                onTrash={moveResourceToTrash}
                onRestore={restoreResource}
                onDeletePermanently={removeResourcePermanently}
              />
            </motion.div>
          ) : !activeResource ? (
            <ResourceLoading />
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
                    setScreen({ kind: 'collection', view: activeView })
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
                    setScreen({ kind: 'collection', view: activeView })
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

      {activeView.kind !== 'flow' && (
        <AIChat
          open={chatOpen}
          scope={activeResource ?? null}
          resources={activeResources}
          onOpenChange={setChatOpen}
          onOpenResource={(resourceId) => openResource(resourceId, activeView)}
          onApplyProposal={applyAiProposal}
          onImportAndAnalyze={(candidates) =>
            importCandidates(
              candidates,
              { x: 240, y: 180 },
              null,
              false,
            )
          }
        />
      )}
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

function loadIdSet(key: string): Set<string> {
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return new Set();
    const parsed: unknown = JSON.parse(stored);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

function isFolderDescendant(
  folderId: string,
  possibleAncestorId: string,
  folders: FolderSummary[],
): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(folderId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.parentId === possibleAncestorId) return true;
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}
