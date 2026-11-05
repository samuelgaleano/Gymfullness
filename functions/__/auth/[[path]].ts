/**
 * Optional: serves Firebase's /__/auth/* helper pages from YOUR domain so Google sign-in by redirect
 * works on iOS Safari (no third-party storage). Enable by setting FIREBASE_PROJECT_ID in Cloudflare
 * and VITE_FIREBASE_AUTH_DOMAIN to your app's domain. Without FIREBASE_PROJECT_ID it answers 404.
 */
interface Ctx {
  request: Request
  env?: Record<string, string | undefined>
}

export const onRequest = async ({ request, env }: Ctx): Promise<Response> => {
  const project = env?.FIREBASE_PROJECT_ID
  if (!project || !/^[a-z0-9-]{4,40}$/.test(project)) return new Response('Not found', { status: 404 })
  const url = new URL(request.url)
  const upstream = new URL(`https://${project}.firebaseapp.com${url.pathname}${url.search}`)
  const init: RequestInit = { method: request.method, headers: request.headers, body: request.body, redirect: 'manual' }
  return fetch(upstream, init)
}
