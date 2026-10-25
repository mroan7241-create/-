/** Explicit, deny-by-default surface for the legally consequential signer role. */
export function signerRouteAllowed(method: string, url: string): boolean {
  const path = url.split('?')[0];
  if (method === 'GET') return path === '/api/v1/auth/me' || /^\/api\/v1\/participations\/signer\/agreements(?:\/[0-9a-f-]{36}(?:\/(?:template|association-signature|final))?)?$/i.test(path);
  if (method === 'POST') return path === '/api/v1/auth/logout' || /^\/api\/v1\/participations\/signer\/agreements\/[0-9a-f-]{36}\/sign$/i.test(path);
  return method === 'PATCH' && path === '/api/v1/auth/password';
}
