import {
  aiChatRequestSchema,
  aiChatResponseSchema,
  createResourceSchema,
  createFolderSchema,
  folderSummarySchema,
  inviteCollaboratorSchema,
  resourceSummarySchema,
  searchResultSchema,
  shareEntrySchema,
  type CreateResourceInput,
  type CreateFolderInput,
  type AiChatResponse,
  type FolderSummary,
  type InviteCollaboratorInput,
  type ShareEntry,
  type SearchResult,
  type UpdateResourceInput,
} from '@fixnote/contracts';
import localforage from 'localforage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  demoSnapshot,
  type WorkspaceResource,
  type WorkspaceSnapshot,
} from '../domain';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
const cache = localforage.createInstance({
  name: 'fixnote',
  storeName: 'workspace',
});

export let supabaseClient: SupabaseClient | null = null;
if (
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY
) {
  supabaseClient = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const cached = await cache.getItem<WorkspaceSnapshot>('snapshot');

  try {
    const [resourceData, folderData] = await Promise.all([
      request('/resources'),
      request('/folders'),
    ]);
    const resources = resourceSummarySchema.array().parse(resourceData);
    const folders = folderSummarySchema.array().parse(folderData);
    const snapshot: WorkspaceSnapshot = {
      folders,
      resources: resources.map((resource, index) => ({
        ...resource,
        preview:
          resource.kind === 'board'
            ? 'Realtime canvas'
            : 'Open to continue writing…',
        accent: ['paper', 'mint', 'blue', 'coral', 'yellow'][
          index % 5
        ] as WorkspaceResource['accent'],
      })),
    };
    await cache.setItem('snapshot', snapshot);
    return snapshot;
  } catch {
    return cached ?? demoSnapshot;
  }
}

export async function createResource(
  input: CreateResourceInput,
  snapshot: WorkspaceSnapshot,
): Promise<WorkspaceResource> {
  const parsed = createResourceSchema.parse(input);
  try {
    const data = resourceSummarySchema.parse(
      await request('/resources', {
        method: 'POST',
        body: JSON.stringify(parsed),
      }),
    );
    return decorateResource(data);
  } catch {
    const now = new Date().toISOString();
    const local: WorkspaceResource = {
      id: parsed.id ?? crypto.randomUUID(),
      ownerId:
        import.meta.env.VITE_MOCK_USER_ID ??
        '00000000-0000-4000-8000-000000000001',
      kind: parsed.kind,
      title: parsed.title,
      folderId: parsed.folderId ?? null,
      role: 'owner',
      position: parsed.position ?? nextPosition(snapshot.resources.length),
      size: parsed.size ?? { width: 320, height: 220 },
      createdAt: now,
      updatedAt: now,
      preview:
        parsed.kind === 'board' ? 'Realtime canvas' : 'Start writing here…',
      accent: parsed.kind === 'board' ? 'blue' : 'paper',
    };
    await saveWorkspace({
      ...snapshot,
      resources: [...snapshot.resources, local],
    });
    return local;
  }
}

export async function updateResource(
  resource: WorkspaceResource,
  input: UpdateResourceInput,
): Promise<WorkspaceResource> {
  const optimistic: WorkspaceResource = {
    ...resource,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
    ...(input.position ? { position: input.position } : {}),
    ...(input.size ? { size: input.size } : {}),
    updatedAt: new Date().toISOString(),
  };

  try {
    const updated = resourceSummarySchema.parse(
      await request(`/resources/${resource.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    );
    return { ...optimistic, ...updated };
  } catch {
    return optimistic;
  }
}

export async function deleteResource(
  resource: WorkspaceResource,
  snapshot: WorkspaceSnapshot,
): Promise<void> {
  try {
    await request(`/resources/${resource.id}`, { method: 'DELETE' });
  } catch {
    await saveWorkspace({
      ...snapshot,
      resources: snapshot.resources.filter((item) => item.id !== resource.id),
    });
  }
}

export async function updateFolder(
  folder: FolderSummary,
  input: { name?: string; parentId?: string | null; position?: { x: number; y: number } },
): Promise<FolderSummary> {
  const optimistic = { ...folder, ...input, updatedAt: new Date().toISOString() };
  try {
    return folderSummarySchema.parse(
      await request(`/folders/${folder.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    );
  } catch {
    return optimistic;
  }
}

export async function createFolder(
  input: CreateFolderInput,
  snapshot: WorkspaceSnapshot,
): Promise<FolderSummary> {
  const parsed = createFolderSchema.parse(input);
  try {
    return folderSummarySchema.parse(
      await request('/folders', { method: 'POST', body: JSON.stringify(parsed) }),
    );
  } catch {
    const now = new Date().toISOString();
    const folder: FolderSummary = {
      id: parsed.id ?? crypto.randomUUID(),
      ownerId: import.meta.env.VITE_MOCK_USER_ID ?? '00000000-0000-4000-8000-000000000001',
      name: parsed.name,
      parentId: parsed.parentId ?? null,
      position: parsed.position ?? { x: 180, y: 420 },
      createdAt: now,
      updatedAt: now,
    };
    await saveWorkspace({ ...snapshot, folders: [...snapshot.folders, folder] });
    return folder;
  }
}

export async function deleteFolder(
  folderId: string,
  snapshot: WorkspaceSnapshot,
): Promise<void> {
  try {
    await request(`/folders/${folderId}`, { method: 'DELETE' });
  } catch {
    await saveWorkspace({
      folders: snapshot.folders.filter((folder) => folder.id !== folderId),
      resources: snapshot.resources.map((resource) =>
        resource.folderId === folderId ? { ...resource, folderId: null } : resource,
      ),
    });
  }
}

export async function saveWorkspace(
  snapshot: WorkspaceSnapshot,
): Promise<void> {
  await cache.setItem('snapshot', snapshot);
}

export async function getRealtimeToken(): Promise<string> {
  if (isMockAuth || !supabaseClient) {
    return `mock:${
      import.meta.env.VITE_MOCK_USER_ID ??
      '00000000-0000-4000-8000-000000000001'
    }`;
  }
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  return session?.access_token ?? '';
}

export async function signOut(): Promise<void> {
  if (supabaseClient) await supabaseClient.auth.signOut();
}

export async function listSharing(resourceId: string): Promise<ShareEntry[]> {
  try {
    return shareEntrySchema
      .array()
      .parse(await request(`/resources/${resourceId}/collaborators`));
  } catch {
    return (
      (await cache.getItem<ShareEntry[]>(`sharing:${resourceId}`)) ?? []
    );
  }
}

export async function inviteCollaborator(
  resourceId: string,
  input: InviteCollaboratorInput,
): Promise<ShareEntry> {
  const parsed = inviteCollaboratorSchema.parse(input);
  try {
    return shareEntrySchema.parse(
      await request(`/resources/${resourceId}/invites`, {
        method: 'POST',
        body: JSON.stringify(parsed),
      }),
    );
  } catch {
    const token = crypto.randomUUID();
    const entry: ShareEntry = {
      id: crypto.randomUUID(),
      email: parsed.email.toLocaleLowerCase(),
      displayName: null,
      role: parsed.role,
      status: 'pending',
      invitationUrl: `fixnote://invite/${token}`,
    };
    const existing = await listSharing(resourceId);
    await cache.setItem(`sharing:${resourceId}`, [...existing, entry]);
    return entry;
  }
}

export async function revokeCollaborator(
  resourceId: string,
  profileId: string,
): Promise<void> {
  try {
    await request(`/resources/${resourceId}/collaborators/${profileId}`, {
      method: 'DELETE',
    });
  } catch {
    const existing = await listSharing(resourceId);
    await cache.setItem(
      `sharing:${resourceId}`,
      existing.filter((entry) => entry.id !== profileId),
    );
  }
}

export async function searchWorkspace(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  try {
    return searchResultSchema
      .array()
      .parse(
        await request(`/search?q=${encodeURIComponent(query.trim())}`, {
          signal: AbortSignal.timeout(10_000),
        }),
      );
  } catch {
    const snapshot =
      (await cache.getItem<WorkspaceSnapshot>('snapshot')) ?? demoSnapshot;
    const normalized = query.toLocaleLowerCase();
    return snapshot.resources
      .filter((resource) =>
        `${resource.title} ${resource.preview}`
          .toLocaleLowerCase()
          .includes(normalized),
      )
      .map((resource) => ({
        resourceId: resource.id,
        nodeId: null,
        kind: resource.kind,
        title: resource.title,
        snippet: resource.preview,
        score: 1,
      }));
  }
}

export async function askAi(
  message: string,
  resourceId?: string,
): Promise<AiChatResponse> {
  const body = aiChatRequestSchema.parse({
    message,
    ...(resourceId ? { resourceId } : {}),
  });
  return aiChatResponseSchema.parse(
    await request('/ai/chat', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    }),
  );
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1_500);

  if (isMockAuth || !supabaseClient) {
    headers.set(
      'x-fixnote-user',
      import.meta.env.VITE_MOCK_USER_ID ??
        '00000000-0000-4000-8000-000000000001',
    );
  } else {
    const token = await getRealtimeToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
  }

  try {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers,
      signal: init?.signal ?? controller.signal,
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    return response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

export const isMockAuth = import.meta.env.VITE_AUTH_MODE === 'mock';

function decorateResource(
  resource: ReturnType<typeof resourceSummarySchema.parse>,
): WorkspaceResource {
  return {
    ...resource,
    preview:
      resource.kind === 'board' ? 'Realtime canvas' : 'Open to start writing…',
    accent: resource.kind === 'board' ? 'blue' : 'paper',
  };
}

function nextPosition(index: number) {
  return {
    x: 240 + (index % 3) * 380,
    y: 160 + Math.floor(index / 3) * 280,
  };
}

export type { FolderSummary };
