import { useEffect, useState } from 'react';
import { loadImportedAsset } from './api';

export function useImportedAssetUrl(assetId: string | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    if (!assetId) {
      setUrl(null);
      return;
    }

    void loadImportedAsset(assetId).then((blob) => {
      if (!blob || disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  return url;
}
