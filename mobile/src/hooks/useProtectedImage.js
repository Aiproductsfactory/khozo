import { useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

import { getApiBaseUrl } from '../services/config';

/**
 * Loads a jurisdiction-protected photo from the Khozo API.
 *
 * `<Image source={{ uri, headers }}>` does not reliably send the bearer token on
 * Android here, so the bytes are fetched explicitly and handed to the Image as a
 * data URI.
 *
 * The download has to land on disk to attach request headers, but the file is
 * deleted as soon as it has been read: the app tells users that case records and
 * child identities are never cached on the phone, and that must stay true.
 */
export function useProtectedImage(photoPath, token) {
  const [uri, setUri] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!photoPath || !token) {
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

        const file = await File.downloadFileAsync(`${getApiBaseUrl()}${photoPath}`, scratch, {
          headers: { Authorization: `Bearer ${token}` },
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
          // A leftover scratch file is cleaned up on the next load or uninstall.
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
