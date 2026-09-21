/** The default is zero trusted proxy hops: client X-Forwarded-For is ignored. */
export function trustedProxyHops(raw = process.env.TRUST_PROXY_HOPS): number {
  if (raw === undefined || raw === '') return 0;
  if (!/^[0-3]$/.test(raw)) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3.');
  return Number(raw);
}
