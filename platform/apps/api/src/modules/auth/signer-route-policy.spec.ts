import { signerRouteAllowed } from './signer-route-policy';
const id = '0195aa00-0000-7000-8000-000000000001';
describe('signer deny-by-default boundary', () => {
  it.each(['/auth/me', '/participations/signer/agreements', `/participations/signer/agreements/${id}`, `/participations/signer/agreements/${id}/template`, `/participations/signer/agreements/${id}/association-signature`, `/participations/signer/agreements/${id}/final`])('allows only required GET %s', path => expect(signerRouteAllowed('GET', '/api/v1' + path)).toBe(true));
  it.each(['/beneficiaries', '/applications', '/dashboard/admin', '/reports/abanmi', '/accounts', '/files', '/participations', `/participations/agreements/${id}/final`, '/participations/signer/agreements/../accounts'])('denies reads and writes to %s', path => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) expect(signerRouteAllowed(method, '/api/v1' + path)).toBe(false);
  });
  it('allows one signing action and password/logout lifecycle, not provisioning or method substitutions', () => {
    expect(signerRouteAllowed('POST', `/api/v1/participations/signer/agreements/${id}/sign`)).toBe(true);
    expect(signerRouteAllowed('GET', `/api/v1/participations/signer/agreements/${id}/sign`)).toBe(false);
    expect(signerRouteAllowed('POST', '/api/v1/auth/logout')).toBe(true);
    expect(signerRouteAllowed('PATCH', '/api/v1/auth/password')).toBe(true);
    expect(signerRouteAllowed('POST', '/api/v1/participations/signer/agreements')).toBe(false);
  });
});
