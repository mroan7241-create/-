import { jest } from '@jest/globals';
import { AccountRole, prisma } from '@alzad/db';
import { AuthService } from './auth.service';
import { hashSecret } from '../../common/password.util';
import { sha256Hex } from '../../common/crypto.util';

describe('signer uses the existing password/session lifecycle', () => {
  afterEach(() => jest.restoreAllMocks());
  it('accepts the dedicated role without OTP, stores only a session hash and retains existing time limits', async () => {
    const password = 'SyntheticSignerPassword2026';
    const account = { id: 'signer', role: AccountRole.COVENANT_SIGNER, status: 'ACTIVE', archivedAt: null, mustChangePassword: false, associationId: null, name: 'موقّع', publicCode: 'USR-TEST' };
    jest.spyOn(prisma.authCredential, 'findUnique').mockResolvedValue({ account, secretHash: await hashSecret(password) } as never);
    const create = jest.spyOn(prisma.authSession, 'create').mockResolvedValue({} as never);
    jest.spyOn(prisma.account, 'update').mockResolvedValue(account as never);
    const reset = jest.spyOn(prisma.passwordResetToken, 'create');
    const audit = { log: jest.fn(async () => undefined) };
    const service = new AuthService({ consume: jest.fn(async () => undefined) } as never, audit as never, {} as never);
    const result = await service.loginUser('malyahya@alzaad.org.sa', password, {});
    expect(result.account).toMatchObject({ role: AccountRole.COVENANT_SIGNER, covenantRequired: false });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: 'signer', tokenHash: sha256Hex(result.rawToken) }) });
    expect(result.absoluteExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(12 * 3600_000);
    expect(reset).not.toHaveBeenCalled();
  });
});
