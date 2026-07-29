import type { FolderSummary, ResourceSummary } from '@fixnote/contracts';

export interface WorkspaceResource extends ResourceSummary {
  preview: string;
  accent: 'paper' | 'mint' | 'blue' | 'coral' | 'yellow';
}

export interface WorkspaceSnapshot {
  folders: FolderSummary[];
  resources: WorkspaceResource[];
}

export const demoSnapshot: WorkspaceSnapshot = {
  folders: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      ownerId: '00000000-0000-4000-8000-000000000001',
      parentId: null,
      position: { x: -160, y: 520 },
      name: 'Product thoughts',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      ownerId: '00000000-0000-4000-8000-000000000001',
      parentId: null,
      position: { x: 260, y: 560 },
      name: 'Research',
      createdAt: '2026-07-21T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    },
  ],
  resources: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      ownerId: '00000000-0000-4000-8000-000000000001',
      folderId: null,
      kind: 'note',
      title: 'FixNote alpha',
      role: 'owner',
      position: { x: 220, y: 170 },
      size: { width: 336, height: 248 },
      preview:
        'A quiet place for ideas, research and half-finished thoughts. Everything starts as a simple note.',
      accent: 'paper',
      createdAt: '2026-07-22T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      ownerId: '00000000-0000-4000-8000-000000000001',
      folderId: null,
      kind: 'board',
      title: 'Launch map',
      role: 'owner',
      position: { x: 610, y: 125 },
      size: { width: 360, height: 280 },
      preview: 'Realtime canvas · 5 objects',
      accent: 'blue',
      createdAt: '2026-07-24T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000003',
      ownerId: '00000000-0000-4000-8000-000000000001',
      folderId: null,
      kind: 'note',
      title: 'Ideas worth keeping',
      role: 'owner',
      position: { x: 1020, y: 230 },
      size: { width: 288, height: 204 },
      preview:
        'Search should feel like remembering, not querying. Let AI connect the small fragments.',
      accent: 'yellow',
      createdAt: '2026-07-25T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    },
  ],
};
