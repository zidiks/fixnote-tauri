import { isTauri } from '@tauri-apps/api/core';

export async function openExternalUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url.toString());
      return;
    } catch {
      // Fall through to the browser behavior.
    }
  }

  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}
