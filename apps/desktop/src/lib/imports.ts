import type {
  ImportCandidate,
  ImportedContent,
  ImportedFileType,
  LinkType,
  WorkspaceResource,
} from '../domain';

export interface PreparedImport {
  title: string;
  preview: string;
  accent: WorkspaceResource['accent'];
  size: WorkspaceResource['size'];
  imported: ImportedContent;
  file?: File;
}

const TEXT_FILE_LIMIT = 200_000;

export function candidatesFromText(raw: string): ImportCandidate[] {
  const text = raw.trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every(isHttpUrl)) {
    return lines.map((url) => ({ kind: 'link', url }));
  }
  return isHttpUrl(text)
    ? [{ kind: 'link', url: text }]
    : [{ kind: 'text', text }];
}

export async function prepareImport(candidate: ImportCandidate): Promise<PreparedImport> {
  if (candidate.kind === 'link') return prepareLink(candidate.url);
  if (candidate.kind === 'text') return prepareText(candidate.text);
  return prepareFile(candidate.file);
}

function prepareLink(rawUrl: string): PreparedImport {
  const url = new URL(rawUrl);
  const linkType = classifyLink(url);
  const host = url.hostname.replace(/^www\./, '');
  return {
    title: titleForLink(url, linkType),
    preview: `${labelForLink(linkType)} · ${host}`,
    accent: linkType === 'youtube' ? 'coral' : linkType === 'audio' ? 'mint' : 'blue',
    size: { width: 330, height: 210 },
    imported: { kind: 'link', url: url.toString(), host, linkType },
  };
}

function prepareText(text: string): PreparedImport {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim();
  return {
    title: truncate(firstLine || 'Pasted text', 80),
    preview: truncate(normalized, 520),
    accent: 'yellow',
    size: { width: 300, height: 250 },
    imported: { kind: 'text', text: text.slice(0, TEXT_FILE_LIMIT) },
  };
}

async function prepareFile(file: File): Promise<PreparedImport> {
  const fileType = classifyFile(file);
  const assetId = crypto.randomUUID();
  const mimeType = file.type || mimeFromName(file.name);
  let text: string | undefined;
  if (fileType === 'text' && file.size <= TEXT_FILE_LIMIT) {
    text = (await file.text()).slice(0, TEXT_FILE_LIMIT);
  }
  return {
    title: truncate(file.name || 'Untitled file', 120),
    preview: text?.trim()
      ? truncate(text.replace(/\s+/g, ' '), 520)
      : `${labelForFile(fileType)} · ${formatBytes(file.size)}`,
    accent:
      fileType === 'image'
        ? 'mint'
        : fileType === 'video'
          ? 'coral'
          : fileType === 'text'
            ? 'yellow'
            : 'paper',
    size:
      fileType === 'image' || fileType === 'video'
        ? { width: 340, height: 260 }
        : { width: 310, height: 220 },
    imported: {
      kind: 'file',
      assetId,
      name: file.name,
      mimeType,
      byteLength: file.size,
      fileType,
      ...(text ? { text } : {}),
    },
    file,
  };
}

export function classifyLink(url: URL): LinkType {
  const host = url.hostname.toLocaleLowerCase().replace(/^www\./, '');
  const extension = url.pathname.split('.').pop()?.toLocaleLowerCase();
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube';
  if (['vimeo.com', 'twitch.tv', 'dailymotion.com', 'rutube.ru'].some((domain) => host.endsWith(domain))) return 'video';
  if (['spotify.com', 'soundcloud.com', 'music.apple.com', 'bandcamp.com'].some((domain) => host.endsWith(domain))) return 'audio';
  if (['x.com', 'twitter.com', 'instagram.com', 'tiktok.com', 'reddit.com', 'linkedin.com', 'facebook.com', 'vk.com'].some((domain) => host.endsWith(domain))) return 'social';
  if (['github.com', 'gitlab.com', 'bitbucket.org', 'codepen.io'].some((domain) => host.endsWith(domain))) return 'code';
  if (extension && ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub'].includes(extension)) return 'document';
  if (['medium.com', 'substack.com', 'dev.to', 'habr.com'].some((domain) => host.endsWith(domain))) return 'article';
  if (url.pathname.split('/').filter(Boolean).length >= 2) return 'article';
  return 'website';
}

export function classifyFile(file: Pick<File, 'name' | 'type'>): ImportedFileType {
  const type = file.type.toLocaleLowerCase();
  const extension = file.name.split('.').pop()?.toLocaleLowerCase() ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('text/') || ['txt', 'md', 'markdown', 'csv', 'json', 'xml', 'yaml', 'yml', 'log', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'py', 'rs'].includes(extension)) return 'text';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'epub', 'rtf'].includes(extension)) return 'document';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(extension)) return 'archive';
  return 'file';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function titleForLink(url: URL, type: LinkType): string {
  if (type === 'youtube') return 'YouTube video';
  const lastPart = url.pathname.split('/').filter(Boolean).at(-1);
  if (!lastPart) return url.hostname.replace(/^www\./, '');
  const decoded = decodeURIComponent(lastPart)
    .replace(/[-_]+/g, ' ')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .trim();
  return truncate(decoded || url.hostname.replace(/^www\./, ''), 90);
}

function labelForLink(type: LinkType): string {
  return ({
    youtube: 'YouTube',
    video: 'Video',
    audio: 'Audio',
    social: 'Social post',
    code: 'Code',
    document: 'Document',
    article: 'Article',
    website: 'Website',
  } satisfies Record<LinkType, string>)[type];
}

function labelForFile(type: ImportedFileType): string {
  return ({
    image: 'Image',
    video: 'Video',
    audio: 'Audio',
    document: 'Document',
    text: 'Text file',
    archive: 'Archive',
    file: 'File',
  } satisfies Record<ImportedFileType, string>)[type];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}

function mimeFromName(name: string): string {
  const extension = name.split('.').pop()?.toLocaleLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'md') return 'text/markdown';
  if (extension === 'json') return 'application/json';
  return 'application/octet-stream';
}
