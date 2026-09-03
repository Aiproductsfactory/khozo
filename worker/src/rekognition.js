/**
 * AWS Rekognition `CompareFaces`, called directly from a Cloudflare Worker.
 *
 * The Node build uses `@aws-sdk/client-rekognition`, which cannot run here —
 * it depends on Node internals the Workers runtime does not provide. Rekognition
 * is a plain JSON-over-HTTPS API though, so the only thing the SDK was really
 * providing is Signature Version 4. That is implemented below with `node:crypto`
 * HMAC, which nodejs_compat does provide.
 *
 * This matters because the Worker is production. Without it, the confirming
 * engine simply did not exist where it counts: every match shown to an officer
 * came from a single provider, with nothing corroborating it.
 */

import crypto from 'node:crypto';

const SERVICE = 'rekognition';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const TIMEOUT_MS = 8000;

const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

/** `20260903T120000Z` and `20260903`, the two forms SigV4 needs. */
function amzDates(now = new Date()) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(secretKey, dateStamp, region) {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}

export function rekognitionConfigured(env) {
  return Boolean(
    (env?.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID) &&
      (env?.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY)
  );
}

/**
 * Compares two images.
 *
 * Returns `{ score, sourceFaces, targetFaces, warnings }` with a 0..1 score, or
 * `null` when Rekognition could not answer. Null means "unknown", which the
 * caller must not read as "no match" — the difference decides whether a
 * candidate is withheld for a good reason or for a network fault.
 */
export async function compareFacesRekognition(env, sourceBuf, targetBuf) {
  if (!rekognitionConfigured(env) || !sourceBuf?.length || !targetBuf?.length) return null;

  const accessKeyId = env?.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env?.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = env?.AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || null;
  const region = env?.AWS_REGION || process.env.AWS_REGION || 'ap-south-1';

  const host = `${SERVICE}.${region}.amazonaws.com`;
  const target = 'RekognitionService.CompareFaces';
  const body = JSON.stringify({
    SourceImage: { Bytes: Buffer.from(sourceBuf).toString('base64') },
    TargetImage: { Bytes: Buffer.from(targetBuf).toString('base64') },
    // Ranking happens here and a human decides afterwards, so ask for
    // everything and apply the confirmation bar in one place.
    SimilarityThreshold: 1,
  });

  const { amzDate, dateStamp } = amzDates();
  const payloadHash = sha256Hex(body);

  const headers = {
    'content-type': 'application/x-amz-json-1.1',
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'x-amz-target': target,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${String(headers[name]).trim()}\n`)
    .join('');

  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey(secretAccessKey, dateStamp, region))
    .update(stringToSign)
    .digest('hex');

  const authorization =
    `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`https://${host}/`, {
      method: 'POST',
      headers: { ...headers, authorization },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Rekognition reports "no face in the image" as a client error. That is a
      // real answer — this pair does not match — not a provider failure.
      if (/InvalidParameterException/.test(text)) {
        return { score: 0, sourceFaces: 0, targetFaces: 0, warnings: ['no_face_detected'] };
      }
      if (res.status === 403) {
        console.warn('[Rekognition] request rejected — check AWS credentials and the Rekognition policy.');
      }
      return null;
    }

    const data = await res.json();
    const best = data.FaceMatches?.[0];
    return {
      score: best ? Number((best.Similarity / 100).toFixed(3)) : 0,
      sourceFaces: data.SourceImageFace ? 1 : 0,
      targetFaces: (data.FaceMatches?.length || 0) + (data.UnmatchedFaces?.length || 0),
      warnings: [],
    };
  } catch (err) {
    console.warn(`[Rekognition] comparison failed${err?.name === 'AbortError' ? ' (timeout)' : ''}:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
