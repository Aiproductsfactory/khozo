export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (!env.API_ORIGIN) {
        return Response.json({ error: 'API_ORIGIN is not configured for this Cloudflare Worker.' }, { status: 503 });
      }

      const cleanOrigin = env.API_ORIGIN.trim().replace(/^["']|["']$/g, '');
      const upstreamUrl = new URL(cleanOrigin);
      const targetUrl = new URL(url.pathname + url.search, upstreamUrl);

      const modifiedHeaders = new Headers(request.headers);
      modifiedHeaders.set('bypass-tunnel-reminder', 'true');

      const init = {
        method: request.method,
        headers: modifiedHeaders,
        redirect: 'follow',
      };

      if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
        init.body = request.body;
      }

      const proxyReq = new Request(targetUrl.toString(), init);
      return fetch(proxyReq);
    }

    return env.ASSETS.fetch(request);
  },
};
