/**
 * A minimal Express-compatible router for Cloudflare Workers.
 *
 * The API routes live in `shared/routes/` and are written against Express's
 * `(req, res, next)` contract. Rather than maintain a second, hand-ported copy
 * of them for the Worker — which is exactly how the two runtimes drifted far
 * enough apart that the mobile app's sighting upload 404'd in production — this
 * shim gives those same handlers the request and response objects they expect.
 *
 * It implements only what `shared/routes/` and `rateLimit.js` actually touch:
 * path params, query, JSON and multipart bodies, `req.user`, and
 * `res.status().json()` / `res.type().send()`. Middleware may be async; each is
 * awaited in turn and the chain stops as soon as one responds without calling
 * `next()`, matching Express's behaviour closely enough for these routes.
 */

import { PHOTO_TOO_LARGE } from '../../../shared/case-domain.js';
import { PHOTO_MAX_BYTES } from '../../../shared/photo-format.js';
import { EXTRA_PHOTO_FIELD, MAX_EXTRA_FILES, MULTIPART_MAX_BYTES, PHOTOS_TOO_LARGE, TOO_MANY_PHOTOS } from '../../../shared/photo-set.js';

const PARAM_PATTERN = /:([A-Za-z_][\w]*)/g;

/**
 * The most a multipart body may carry beyond its one photo: the form's text
 * fields. A body declaring more than photo + this, without extra photos, is
 * refused as one photo too large; with them, the whole body may reach
 * MULTIPART_MAX_BYTES (shared/photo-set.js).
 */
const MULTIPART_FIELDS_ALLOWANCE = 512 * 1024;

/** A body the router refuses to parse, answered as Express's multer would be. */
class BodyRejected extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Compiles an Express path pattern (`/found/:id/review`) into a matcher. */
function compilePath(pattern) {
  const names = [];
  const source = pattern
    .replace(/\/+$/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(PARAM_PATTERN, (_m, name) => {
      names.push(name);
      return '([^/]+)';
    });
  const regex = new RegExp(`^${source || ''}/?$`);
  return (pathname) => {
    const match = regex.exec(pathname.replace(/\/+$/, '') || '/');
    if (!match) return null;
    const params = {};
    names.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return params;
  };
}

export function createRouter() {
  const routes = [];
  // Router-level middleware added with `use()`. In Express it sits in the stack
  // at the point it was added, so it guards the routes registered after it and
  // not those before; attaching it to subsequent registrations reproduces that.
  const shared = [];

  const register = (method) => (path, ...handlers) => {
    routes.push({
      method,
      path,
      match: compilePath(path === '/' ? '' : path),
      handlers: [...shared, ...handlers.flat()].filter(Boolean),
    });
    return router;
  };

  const router = {
    routes,
    use: (...handlers) => {
      shared.push(...handlers.flat().filter(Boolean));
      return router;
    },
    get: register('GET'),
    post: register('POST'),
    put: register('PUT'),
    patch: register('PATCH'),
    delete: register('DELETE'),
  };

  return router;
}

/** Collects what a handler wrote, then converts it into a `Response`. */
function createResponse() {
  const state = { status: 200, headers: {}, body: undefined, kind: null, sent: false };

  const res = {
    status(code) {
      state.status = code;
      return res;
    },
    setHeader(name, value) {
      state.headers[name] = String(value);
      return res;
    },
    set(name, value) {
      return res.setHeader(name, value);
    },
    type(mime) {
      state.headers['Content-Type'] = mime;
      return res;
    },
    json(payload) {
      state.kind = 'json';
      state.body = payload;
      state.sent = true;
      return res;
    },
    send(payload) {
      state.kind = 'raw';
      state.body = payload;
      state.sent = true;
      return res;
    },
    end() {
      state.kind = state.kind || 'empty';
      state.sent = true;
      return res;
    },
  };

  return { res, state };
}

function toResponse(state) {
  const headers = { ...state.headers };
  if (state.kind === 'json') {
    headers['Content-Type'] = 'application/json';
    return new Response(JSON.stringify(state.body), { status: state.status, headers });
  }
  if (state.kind === 'raw') {
    const body = state.body;
    // Node Buffers arrive as Uint8Array views; hand the Response the exact bytes.
    const bytes =
      body instanceof Uint8Array
        ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
        : body;
    return new Response(bytes, { status: state.status, headers });
  }
  return new Response(null, { status: state.status, headers });
}

/** One uploaded file, in the shape multer gives it. */
async function filePart(key, value) {
  return {
    fieldname: key,
    originalname: value.name || 'upload',
    mimetype: value.type || 'application/octet-stream',
    size: value.size ?? 0,
    buffer: Buffer.from(await value.arrayBuffer()),
  };
}

/**
 * Parses the body once, into the `req.body` / `req.file` shape multer
 * produces, plus `req.extraFiles`: the photos sent under EXTRA_PHOTO_FIELD
 * beside the main one (shared/photo-set.js), as server/src/routes/reports.js
 * gives them on Express.
 */
async function readBody(request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return { body: await request.json().catch(() => ({})), file: null, extraFiles: [] };
  }

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    // The photo limit Express applies (multer, 8 MB a photo), applied here
    // too: a declared length over the whole-body cap is refused before the
    // body is read at all, and a file part over 8 MB once it has been.
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MULTIPART_MAX_BYTES) {
      throw new BodyRejected(413, PHOTOS_TOO_LARGE);
    }
    const form = await request.formData().catch(() => null);
    if (!form) return { body: {}, file: null, extraFiles: [] };
    const body = {};
    let file = null;
    const extraFiles = [];
    for (const [key, value] of form.entries()) {
      if (value && typeof value === 'object' && typeof value.arrayBuffer === 'function') {
        if ((value.size ?? 0) > PHOTO_MAX_BYTES) throw new BodyRejected(413, PHOTO_TOO_LARGE);
        if (key === EXTRA_PHOTO_FIELD) {
          if (extraFiles.length >= MAX_EXTRA_FILES) throw new BodyRejected(400, TOO_MANY_PHOTOS);
          extraFiles.push(await filePart(key, value));
        } else if (!file) {
          // The main photo: the first file part not sent as an extra, under
          // whatever name, as every route has always read it.
          file = await filePart(key, value);
        }
      } else {
        body[key] = value;
      }
    }
    // One photo larger than the old single-photo body allowed is answered as
    // before: that photo is too large.
    if (!extraFiles.length && Number.isFinite(declared) && declared > PHOTO_MAX_BYTES + MULTIPART_FIELDS_ALLOWANCE) {
      throw new BodyRejected(413, PHOTO_TOO_LARGE);
    }
    return { body, file, extraFiles };
  }

  return { body: {}, file: null, extraFiles: [] };
}

/**
 * Runs a request through a router built by `createRouter`.
 *
 * `basePath` is the mount point (`/api/reports`), stripped before matching so
 * the shared routes keep their Express-relative paths.
 */
export async function handleRequest(router, request, { basePath = '', context = {} } = {}) {
  const url = new URL(request.url);
  const pathname = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) || '/' : url.pathname;

  const headers = {};
  for (const [key, value] of request.headers.entries()) headers[key.toLowerCase()] = value;

  let parsed = null;
  for (const route of router.routes) {
    if (route.method !== request.method) continue;
    const params = route.match(pathname);
    if (!params) continue;

    if (!parsed) {
      try {
        parsed = await readBody(request);
      } catch (err) {
        if (!(err instanceof BodyRejected)) throw err;
        return new Response(JSON.stringify({ error: err.message }), {
          status: err.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const req = {
      method: request.method,
      path: pathname,
      baseUrl: basePath,
      route: { path: route.path },
      originalUrl: url.pathname + url.search,
      headers,
      params,
      query: Object.fromEntries(url.searchParams.entries()),
      body: parsed.body,
      file: parsed.file,
      extraFiles: parsed.extraFiles || [],
      user: null,
      ip: headers['cf-connecting-ip'] || (headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown',
      socket: {},
      ...context,
    };

    const { res, state } = createResponse();

    for (const handler of route.handlers) {
      let advanced = false;
      // eslint-disable-next-line no-await-in-loop
      await handler(req, res, () => {
        advanced = true;
      });
      if (state.sent) return toResponse(state);
      if (!advanced) {
        // A handler that neither responded nor called next() would hang in
        // Express; here it is a bug worth surfacing rather than a blank 200.
        return new Response(JSON.stringify({ error: 'Request handler did not complete' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (state.sent) return toResponse(state);
  }

  return null;
}
