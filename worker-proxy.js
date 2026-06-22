addEventListener('fetch', event => {
  event.respondWith(handle(event.request))
})

async function handle(request){
  const url = new URL(request.url);
  // proxy /api/* to your origin (edit ORIGIN_BASE below)
  if (url.pathname.startsWith('/api/')){
    const ORIGIN_BASE = 'http://127.0.0.1:5000'; // change to your production origin
    const forwardUrl = ORIGIN_BASE + url.pathname + url.search;

    const forwardReq = new Request(forwardUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual'
    });

    const resp = await fetch(forwardReq);
    const headers = new Headers(resp.headers);
    // expose CORS for development — lock this down in production
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-allow-credentials', 'true');

    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
  }

  return fetch(request);
}
