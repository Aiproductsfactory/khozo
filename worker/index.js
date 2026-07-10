function jsonError(message, status = 500) {
  return Response.json({ error: message }, { status });
}

function apiProxyRequest(request, apiOrigin) {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(apiOrigin);
  const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, upstreamUrl);

  return new Request(targetUrl.toString(), request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (!env.API_ORIGIN) {
        return jsonError('API_ORIGIN is not configured for this Cloudflare Worker.', 503);
      }

      return fetch(apiProxyRequest(request, env.API_ORIGIN));
    }

    return env.ASSETS.fetch(request);
  },
};
