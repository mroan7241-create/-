import { Inject, Injectable } from '@nestjs/common';
import { prisma, Prisma, AuthCredentialType } from '@alzad/db';
import { createHash } from 'node:crypto';
import { ApiError } from '../../../common/api-error';
import { EmailService, enqueueEmail } from './email.service';

/** Queue notifications in the business transaction; encrypted outbox owns retries. */
@Injectable()
export class OnboardingEmailService {
  constructor(@Inject(EmailService) email: EmailService) { void email; }

  async sendCovenantCompletion(agreementId: string, finalPdf: Buffer, tx?: Prisma.TransactionClient): Promise<{ ok: boolean; alreadySent?: boolean; alreadyQueued?: boolean; emailQueued?: boolean; eventId?: string }> {
    if (!tx) return prisma.$transaction(client => this.sendCovenantCompletion(agreementId, finalPdf, client));
    await tx.$queryRaw`SELECT id FROM participation_agreements WHERE id=${agreementId}::uuid FOR UPDATE`;
    const agreement = await tx.participationAgreement.findUniqueOrThrow({ where: { id: agreementId }, include: { associationAccount: true, finalFile: true } });
    const account = agreement.associationAccount;
    if (agreement.status !== 'SIGNED' || !agreement.fullyExecutedAt || !agreement.finalFile || !account?.email || createHash('sha256').update(finalPdf).digest('hex') !== agreement.finalSha256) {
      throw new ApiError('COVENANT_FINAL_NOT_FOUND', 'النسخة المعتمدة للميثاق غير متاحة', 409);
    }
    const key = `COVENANT_COMPLETION_EMAIL:${agreement.id}`;
    const row = await tx.systemSetting.findUnique({ where: { key } });
    if (row) {
      const marker = row.value as { status?: string; eventId?: string };
      if (marker.status === 'SENT') return { ok: true, alreadySent: true };
      if (typeof marker.eventId === 'string' && marker.eventId) return { ok: true, alreadyQueued: true, emailQueued: true, eventId: marker.eventId };
      // Historical SMTP attempts have no durable event ownership: do not guess
      // whether the provider accepted them or create an unsafe duplicate.
      return { ok: false };
    }
    const queued = await enqueueEmail(tx, 'NOTICE', {
      to: account.email, name: account.name,
      subject: 'اكتمال اعتماد الميثاق وتفعيل بوابة الجمعية — مشروع الأجهزة الكهربائية',
      body: `اكتمل توقيع ميثاق الالتزام بالمشاركة والتنفيذ من الطرفين، وتم تفعيل بوابة جمعيتكم.\nرقم الميثاق: ${agreement.reference ?? agreement.id}\nتجدون النسخة المعتمدة مرفقة بهذه الرسالة، ويمكنكم الدخول ببيانات حسابكم الحالية ومباشرة مهام المشروع.\nبوابة الجمعية: ${publicWebUrl()}/association\nنسعد بشراكتكم، ونتطلع إلى تعاون مثمر.`,
      action: { label: 'الدخول إلى بوابة الجمعية', url: `${publicWebUrl()}/association` },
    }, { type: 'covenant', agreementId: agreement.id, fileId: agreement.finalFile.id, sha256: agreement.finalSha256!, markerKey: key, filename: `covenant-${agreement.reference ?? agreement.id}.pdf` });
    await tx.systemSetting.create({ data: { key, value: { status: 'QUEUED', eventId: queued.eventId } } });
    return { ok: true, alreadySent: false, ...queued };
  }

  async sendCredentials(accountId: string, temporaryPassword: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    if (!tx) return prisma.$transaction(client => this.sendCredentials(accountId, temporaryPassword, client));
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    const credential = await tx.authCredential.findFirst({ where: { accountId, type: AuthCredentialType.EMAIL_PASSWORD } });
    if (!account.email || !account.mustChangePassword || !credential) throw new Error('Onboarding account is not ready');
    await enqueueEmail(tx, 'NOTICE', {
      to: account.email, name: account.name,
      subject: 'بيانات دخول الجمعية — مشروع الأجهزة الكهربائية',
      body: `تم تجهيز حساب جمعيتكم.\nالبريد الإلكتروني: ${account.email}\nكلمة المرور المؤقتة: ${temporaryPassword}\nتسجيل الدخول: ${publicWebUrl()}/login\nيجب تغيير كلمة المرور عند أول دخول، ثم مراجعة الميثاق وتوقيعه. تبقى الخدمات التشغيلية مقيدة حتى اكتمال متطلبات التفعيل.\nيرجى الحفاظ على سرية بيانات الدخول.`,
    }, { type: 'credentials', accountId, credentialHash: credential.secretHash });
    return true;
  }

  async sendRejection(applicationId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    if (!tx) return prisma.$transaction(client => this.sendRejection(applicationId, client));
    const application = await tx.associationApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (application.status !== 'REJECTED' && application.eligibilityStatus !== 'FAILED') throw new Error('Application rejection is not committed');
    const reason = application.rejectReason ?? application.eligibilityNotes ?? 'عدم استيفاء متطلبات المشاركة';
    await enqueueEmail(tx, 'NOTICE', {
      // A missing legacy recipient is a terminal mail error, not permission to
      // undo an otherwise valid business decision; the worker reports it.
      to: application.email ?? '', name: application.name,
      subject: 'نتيجة طلب المشاركة — مشروع الأجهزة الكهربائية',
      body: `شكرًا لتقديم جمعيتكم. ${application.eligibilityStatus === 'FAILED' ? 'لم يجتز طلبكم متطلبات الأهلية' : 'نعتذر عن عدم قبول الطلب'} ${application.publicCode}.\nالسبب: ${reason}\nمتابعة الطلب: ${publicWebUrl()}/apply/status\nنقدّر اهتمامكم بالمشروع.`,
    }, { type: 'rejection', applicationId, expectedReason: reason });
    return true;
  }
}

function publicWebUrl(): string {
  const url = new URL(process.env.PUBLIC_WEB_URL?.trim() || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000'));
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('PUBLIC_WEB_URL must use HTTPS');
  return url.origin;
}
