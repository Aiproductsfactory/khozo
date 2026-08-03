import { useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

import { getApiBaseUrl } from '../services/config';

/**
 * Loads a photo from the Khozo API.
 * Supports both protected jurisdiction photos (with Bearer token) and public bulletin photos.
 */
export function useProtectedImage(photoPath, token) {
  const [uri, setUri] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!photoPath) {
      setUri(null);
      return undefined;
    }

    let cancelled = false;
    let scratch = null;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const dir = new Directory(Paths.cache, 'protected-photo');
        if (!dir.exists) dir.create({ intermediates: true });
        scratch = new File(dir, `${String(photoPath).replace(/\W+/g, '_')}.img`);

        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const file = await File.downloadFileAsync(`${getApiBaseUrl()}${photoPath}`, scratch, {
          headers,
          idempotent: true,
        });
        const base64 = await file.base64();
        if (!cancelled) setUri(`data:image/jpeg;base64,${base64}`);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        try {
          if (scratch?.exists) scratch.delete();
        } catch {
          // Scratch cleanup
        }
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photoPath, token]);

  return { uri, error, loading };
}

export default useProtectedImage;
