import assert from 'node:assert/strict';
import { test } from 'node:test';
// Node 24's type-stripping runner needs the explicit TypeScript extension.
// @ts-ignore -- standalone node --test import
import { canCompleteParticipationSetup, canCreateCovenantSigningAccount, participationStageLabel } from './participation-stage.ts';

const awaiting = { status: 'APPROVED_AWAITING_SETUP', selectionList: 'MAIN', agreementStatus: 'SENT', setupCompletedAt: null, associationId: null };

test('setup is offered only for participation awaiting setup', () => {
  assert.equal(canCompleteParticipationSetup(awaiting), true);
  assert.equal(canCompleteParticipationSetup({ ...awaiting, status: 'ACTIVE' }), false);
  assert.equal(canCompleteParticipationSetup({ ...awaiting, setupCompletedAt: 'done' }), false);
});

test('restricted signing account cannot be offered before setup, main selection, or sent covenant', () => {
  assert.equal(canCreateCovenantSigningAccount(awaiting), false);
  assert.equal(canCreateCovenantSigningAccount({ ...awaiting, setupCompletedAt: 'done' }), true);
  assert.equal(canCreateCovenantSigningAccount({ ...awaiting, setupCompletedAt: 'done', selectionList: 'RESERVE' }), false);
  assert.equal(canCreateCovenantSigningAccount({ ...awaiting, setupCompletedAt: 'done', agreementStatus: 'DRAFT' }), false);
  assert.equal(canCreateCovenantSigningAccount({ ...awaiting, setupCompletedAt: 'done', associationId: 'existing' }), false);
});

test('onboarding stages progress to automatic activation after both signatures', () => {
  assert.equal(participationStageLabel({ ...awaiting, agreementStatus: 'DRAFT' }), 'إرسال الميثاق وإكمال التجهيز');
  assert.equal(participationStageLabel(awaiting), 'إكمال التجهيز');
  assert.equal(participationStageLabel({ ...awaiting, setupCompletedAt: 'done' }), 'إنشاء حساب توقيع الجمعية');
  assert.equal(participationStageLabel({ ...awaiting, setupCompletedAt: 'done', associationId: 'association' }), 'بانتظار توقيع ممثل الجمعية');
  assert.equal(participationStageLabel({ ...awaiting, setupCompletedAt: 'done', agreementStatus: 'SIGNED_BY_ORG' }), 'بانتظار توقيع الطرف الأول');
  assert.equal(participationStageLabel({ ...awaiting, status: 'ACTIVE', agreementStatus: 'SIGNED' }), 'مفعّلة — الميثاق مكتمل');
});
