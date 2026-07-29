import type { FolderSummary, ResourceSummary } from '@fixnote/contracts';

export type LinkType =
  | 'youtube'
  | 'video'
  | 'audio'
  | 'social'
  | 'code'
  | 'document'
  | 'article'
  | 'website';

export type ImportedFileType =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'text'
  | 'archive'
  | 'file';

export interface LinkPreviewMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

export interface YoutubePlayback {
  resourceId: string;
  videoId: string;
  title: string;
}

export type ImportedContent =
  | {
      kind: 'link';
      url: string;
      host: string;
      linkType: LinkType;
      videoId?: string;
      metadata?: LinkPreviewMetadata;
    }
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'file';
      assetId: string;
      name: string;
      mimeType: string;
      byteLength: number;
      fileType: ImportedFileType;
      text?: string;
    };

export type ImportCandidate =
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'file'; file: File };

export interface WorkspaceResource extends ResourceSummary {
  preview: string;
  accent: 'paper' | 'mint' | 'blue' | 'coral' | 'yellow';
  imported?: ImportedContent;
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
      color: 'default',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      ownerId: '00000000-0000-4000-8000-000000000001',
      parentId: null,
      position: { x: 260, y: 560 },
      name: 'Research',
      color: 'default',
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
