import { trustedProxyHops } from './proxy.config';

describe('trusted proxy configuration', () => {
  test('defaults to no trusted client-supplied forwarding headers', () => {
    expect(trustedProxyHops(undefined)).toBe(0);
    expect(trustedProxyHops('')).toBe(0);
  });

  test.each(['0', '1', '2', '3'])('accepts a bounded hop count %s', (value) => {
    expect(trustedProxyHops(value)).toBe(Number(value));
  });

  test.each(['true', '-1', '4', '1.5', ' 1 ', 'all'])('rejects unsafe hop count %s', (value) => {
    expect(() => trustedProxyHops(value)).toThrow(/TRUST_PROXY_HOPS/);
  });
});
