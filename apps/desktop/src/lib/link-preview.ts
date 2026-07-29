import type { LinkPreviewMetadata } from '../domain';
import { fetchLinkPreview } from './api';

const previewCache = new Map<
  string,
  LinkPreviewMetadata | Promise<LinkPreviewMetadata>
>();

export async function loadLinkPreview(
  url: string,
): Promise<LinkPreviewMetadata> {
  const cached = previewCache.get(url);
  if (cached) return cached;

  const pending = fetchLinkPreview(url)
    .then((metadata) => {
      previewCache.set(url, metadata);
      return metadata;
    })
    .catch((error) => {
      previewCache.delete(url);
      throw error;
    });
  previewCache.set(url, pending);
  return pending;
}
