import { AccountRole, prisma } from '@alzad/db';
import { jest } from '@jest/globals';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { AuthContext } from '../auth/auth.types';
import type { StorageService } from '../files/storage.service';
import { AbanmiReaderService } from './abanmi-reader.service';
import { AbanmiExploreDto } from './dto/abanmi-explore.dto';

describe('ABANMI dedicated reader', () => {
  const ctx = { role: AccountRole.ABANMI, accountId: 'reader', associationId: null } as AuthContext;
  const sign = jest.fn(async () => 'https://storage.example/temporary');
  const service = new AbanmiReaderService({ getSignedGetUrl: sign } as unknown as StorageService);
  afterEach(() => { jest.restoreAllMocks(); sign.mockClear(); });
  it('denies other roles at service boundary before touching data', async () => {
    for (const role of [AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE]) {
      await expect(service.record({ ...ctx, role }, 'receipts', 'id')).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
      await expect(service.deliveryEvidence({ ...ctx, role }, 'id', 'photo')).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    }
    expect(sign).not.toHaveBeenCalled();
  });
  it('bounds pagination and rejects malformed or unknown filters', async () => {
    for (const input of [{ kind: 'beneficiaries', page: 0 }, { kind: 'receipts', pageSize: 999 }, { kind: 'accounts' }, { kind: 'deliveries', associationId: 'bad' }]) {
      expect((await validate(plainToInstance(AbanmiExploreDto, input))).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(AbanmiExploreDto, { kind: 'receipts', page: '1', pageSize: '20' }))).toHaveLength(0);
    await expect(service.explore(ctx, { kind: 'receipts', status: 'UNKNOWN', page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });
  it('selects only safe beneficiary fields and enforces archived record exclusion', async () => {
    const read = jest.spyOn(prisma.beneficiary, 'findFirst').mockResolvedValue({ id: 'x', publicCode: 'BEN-1', reviewStatus: 'APPROVED', needs: [], deviceAllocations: [], deliveryMissions: [] } as never);
    await service.record(ctx, 'beneficiaries', 'x');
    const args = read.mock.calls[0][0]!;
    expect(args.where).toMatchObject({ id: 'x', archivedAt: null, association: { archivedAt: null } });
    for (const field of ['name', 'phone', 'secondaryPhone', 'address', 'income', 'notes', 'latitude', 'longitude']) expect(args.select).not.toHaveProperty(field);
    expect(args.select?.deliveryMissions).toMatchObject({ take: 50 });
  });
  it('returns receipt quantities, never signatures or receiver information', async () => {
    const read = jest.spyOn(prisma.receiptBatch, 'findFirst').mockResolvedValue({ publicCode: 'REC-1', items: [] } as never);
    await service.record(ctx, 'receipts', 'id');
    const select = read.mock.calls[0][0]?.select;
    for (const field of ['receiverName', 'receiverTitle', 'signatureFileId', 'adminProofFileId', 'notes']) expect(select).not.toHaveProperty(field);
    expect(select?.items).toMatchObject({ select: { sentQty: true, goodQty: true, damagedQty: true, missingQty: true } });
  });
  it('does not return raw file IDs from delivery attempts', async () => {
    jest.spyOn(prisma.deliveryMission, 'findFirst').mockResolvedValue({ publicCode: 'DEL-1', attempts: [{ id: 'attempt', publicCode: 'ATT-1', status: 'DELIVERED', proofFileId: 'private-file', recipientSignatureFileId: null }] } as never);
    const value = await service.record(ctx, 'deliveries', 'id');
    expect(JSON.stringify(value)).not.toContain('private-file');
    expect(value).toMatchObject({ attempts: [{ hasProof: true, hasSignature: false }] });
  });
  it('signs only a file attached to the requested delivery attempt for 120 seconds', async () => {
    const read = jest.spyOn(prisma.deliveryAttempt, 'findFirst').mockResolvedValue({ proofFile: { objectKey: 'attempt-proof', mimeType: 'image/png' }, signatureFile: null } as never);
    expect(await service.deliveryEvidence(ctx, 'attempt', 'photo')).toMatchObject({ expiresIn: 120 });
    expect(read.mock.calls[0][0]?.where).toMatchObject({ id: 'attempt', mission: { association: { archivedAt: null }, beneficiary: { archivedAt: null } } });
    expect(sign).toHaveBeenCalledWith('attempt-proof', 120);
    await expect(service.deliveryEvidence(ctx, 'attempt', 'signature')).rejects.toMatchObject({ code: 'EVIDENCE_NOT_FOUND' });
    await expect(service.deliveryEvidence(ctx, 'attempt', 'arbitrary-file')).rejects.toMatchObject({ code: 'INVALID_KIND' });
  });
  it('does not sign arbitrary file IDs through activity evidence', async () => {
    jest.spyOn(prisma.activityEvidence, 'findUnique').mockResolvedValue(null);
    await expect(service.evidence(ctx, 'arbitrary-file')).rejects.toMatchObject({ code: 'EVIDENCE_NOT_FOUND' });
    expect(sign).not.toHaveBeenCalled();
  });
  it('does not expose executable HTML or SVG as a delivery witness', async () => {
    for (const mimeType of ['text/html', 'image/svg+xml']) {
      jest.spyOn(prisma.deliveryAttempt, 'findFirst').mockResolvedValue({ proofFile: { objectKey: 'unsafe', mimeType }, signatureFile: null } as never);
      await expect(service.deliveryEvidence(ctx, 'attempt', 'photo')).rejects.toMatchObject({ code: 'EVIDENCE_TYPE_UNSUPPORTED' });
    }
    expect(sign).not.toHaveBeenCalled();
  });
  it('filters completed deliveries without including archived beneficiaries', async () => {
    const read = jest.spyOn(prisma.deliveryMission, 'findMany').mockResolvedValue([]);
    jest.spyOn(prisma.deliveryMission, 'count').mockResolvedValue(0);
    jest.spyOn(prisma, '$transaction').mockResolvedValue([[], 0] as never);
    await service.explore(ctx, { kind: 'deliveries', status: 'COMPLETED', page: 1, pageSize: 20 });
    expect(read.mock.calls[0][0]?.where).toMatchObject({ beneficiary: { archivedAt: null }, status: { in: ['DELIVERED', 'DELIVERY_CLOSED'] } });
  });
  it('keeps association approved needs, actual sent quantities and confirmed receipts distinct', async () => {
    jest.spyOn(prisma.association, 'findFirst').mockResolvedValue({ id: 'association' } as never);
    const needs = jest.spyOn(prisma.beneficiaryNeed, 'count').mockResolvedValue(10);
    const sent = jest.spyOn(prisma.shipmentItem, 'aggregate').mockResolvedValue({ _sum: { shippedQty: 8 } } as never);
    const receipts = jest.spyOn(prisma.receiptItem, 'aggregate').mockResolvedValue({ _sum: { goodQty: 5 } } as never);
    jest.spyOn(prisma, '$transaction').mockResolvedValue([null, [], [], { _sum: { goodQty: 5 } }, [], [], 10, { _sum: { shippedQty: 8 } }] as never);
    expect(await service.record(ctx, 'associations', 'association')).toMatchObject({ approvedNeeds: 10, sentQty: 8, received: { goodQty: 5 } });
    expect(needs.mock.calls[0][0]?.where).toMatchObject({ decisionStatus: 'APPROVED', beneficiary: { archivedAt: null } });
    expect(sent.mock.calls[0][0]?.where).toMatchObject({ shipment: { status: { notIn: ['PLANNED', 'CANCELLED'] } } });
    expect(receipts.mock.calls[0][0]?.where).toMatchObject({ receiptBatch: { confirmedAt: { not: null }, status: { in: ['RECEIVED_COMPLETE', 'RECEIVED_WITH_DISCREPANCIES'] } } });
  });
});
