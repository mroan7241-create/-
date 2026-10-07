import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { OutboxEventType, type Prisma } from '@alzad/db';
import { emailDeliveryEncryptionKey } from '../../../config/email.config';
import { isEmail } from 'class-validator';

export type EmailDeliveryKind = 'APPLICATION_ACCESS' | 'PASSWORD_RESET' | 'NOTICE';
export type EmailDeliveryContext =
  | { type: 'access'; draftTokens: Array<{ id: string; draftId: string; predecessorIds: string[] }>; expected?: { applicationId: string; selectionList?: 'MAIN' | 'RESERVE'; selectionApprovedAt?: string | null; informationRequestId?: string } }
  | { type: 'reset'; tokenId: string; accountId: string; credentialHash: string; predecessorIds: string[] }
  | { type: 'credentials'; accountId: string; credentialHash: string }
  | { type: 'rejection'; applicationId: string; expectedReason?: string }
  | { type: 'covenant'; agreementId: string; fileId: string; sha256: string; markerKey: string; filename: string }
  | { type: 'notice'; accountId: string };
export type EmailDeliveryPhase = 'READY' | 'SMTP_STARTED' | 'SMTP_ACCEPTED';
export interface EmailDeliveryPayload {
  version: 1; kind: EmailDeliveryKind; phase: EmailDeliveryPhase;
  iv: string; tag: string; ciphertext: string;
}
export interface EmailSendOptions { messageId: string }
export type QueuedEmailParams = {
  APPLICATION_ACCESS: ApplicationAccessEmailParams;
  PASSWORD_RESET: PasswordResetEmailParams;
  NOTICE: Omit<SecurityAlertEmailParams, 'pdfAttachment'>;
};
export interface DecryptedEmailDelivery { kind: EmailDeliveryKind; params: QueuedEmailParams[EmailDeliveryKind]; context: EmailDeliveryContext }

export function encryptEmailDelivery<K extends EmailDeliveryKind>(id: string, kind: K, params: QueuedEmailParams[K], context: EmailDeliveryContext): EmailDeliveryPayload {
  const rejectBinary = (value: unknown): void => {
    if (Buffer.isBuffer(value)) throw new Error('MAIL_PAYLOAD_INVALID');
    if (value && typeof value === 'object') for (const child of Object.values(value)) rejectBinary(child);
  };
  rejectBinary({ params, context });
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', emailDeliveryEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(`email-delivery:${id}:1:${kind}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ kind, params, context }), 'utf8'), cipher.final()]);
  return { version: 1, kind, phase: 'READY', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptEmailDelivery(id: string, payload: EmailDeliveryPayload): DecryptedEmailDelivery {
  try {
    if (payload.version !== 1 || !['APPLICATION_ACCESS', 'PASSWORD_RESET', 'NOTICE'].includes(payload.kind) || !['READY', 'SMTP_STARTED', 'SMTP_ACCEPTED'].includes(payload.phase)) throw new Error();
    const iv = Buffer.from(payload.iv, 'base64'), tag = Buffer.from(payload.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', emailDeliveryEncryptionKey(), iv);
    decipher.setAAD(Buffer.from(`email-delivery:${id}:1:${payload.kind}`)); decipher.setAuthTag(tag);
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as DecryptedEmailDelivery;
    if (value.kind !== payload.kind || !value.params || typeof value.params.to !== 'string' || !isEmail(value.params.to) || !value.context || !['access', 'reset', 'credentials', 'rejection', 'covenant', 'notice'].includes(value.context.type)) throw new Error();
    if ((value.context.type === 'access') !== (value.kind === 'APPLICATION_ACCESS') || (value.context.type === 'reset') !== (value.kind === 'PASSWORD_RESET')) throw new Error();
    return value;
  } catch { throw new Error('MAIL_PAYLOAD_INVALID'); }
}

export async function enqueueEmail<K extends EmailDeliveryKind>(tx: Prisma.TransactionClient, kind: K, params: QueuedEmailParams[K], context: EmailDeliveryContext): Promise<{ eventId: string; emailQueued: true }> {
  const eventId = randomUUID(), payload = encryptEmailDelivery(eventId, kind, params, context);
  await tx.outboxEvent.create({ data: { id: eventId, type: OutboxEventType.EMAIL_DELIVERY, payload: payload as unknown as Prisma.InputJsonValue } });
  return { eventId, emailQueued: true };
}

export function classifyEmailFailure(error: unknown): { code: string; retryable: boolean } {
  const value = error && typeof error === 'object' ? error as { code?: unknown; command?: unknown; responseCode?: unknown } : {};
  const preSend = ['CONN', 'EHLO', 'STARTTLS', 'AUTH', 'AUTH PLAIN', 'AUTH LOGIN', 'MAIL FROM', 'RCPT TO'].includes(String(value.command));
  const transient = ['ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'EDNS', 'ETIMEDOUT', 'ESOCKET'].includes(String(value.code));
  if (preSend && (transient || (typeof value.responseCode === 'number' && value.responseCode >= 400 && value.responseCode <= 499))) return { code: 'MAIL_TEMPORARY_FAILURE', retryable: true };
  if (value.code === 'MAIL_RECIPIENT_NOT_ACCEPTED' || (preSend && (value.code === 'EAUTH' || value.code === 'EENVELOPE' || (typeof value.responseCode === 'number' && value.responseCode >= 500 && value.responseCode <= 599)))) return { code: 'MAIL_DELIVERY_REJECTED', retryable: false };
  return { code: 'MAIL_DELIVERY_UNCERTAIN', retryable: false };
}
export interface PasswordResetEmailParams {
  to: string;
  name: string;
  code: string;
  invitation?: boolean;
  adminInvitation?: boolean;
}

export interface SecurityAlertEmailParams {
  to: string;
  name: string;
  subject: string;
  body: string;
  action?: { label: string; url: string };
  pdfAttachment?: { filename: string; content: Buffer };
}

export interface ApplicationAccessEmailItem {
  label: string;
  code: string;
  url: string;
}

export interface ApplicationAccessEmailParams {
  to: string;
  name: string;
  subject: string;
  intro: string;
  items: ApplicationAccessEmailItem[];
}

export interface OperationalDigestEmailParams {
  to: string;
  subject: string;
  text: string;
}

export abstract class EmailService {
  abstract sendPasswordResetCode(params: PasswordResetEmailParams, options?: EmailSendOptions): Promise<void>;
  abstract sendSecurityAlert(params: SecurityAlertEmailParams, options?: EmailSendOptions): Promise<void>;
  abstract sendApplicationAccess(params: ApplicationAccessEmailParams, options?: EmailSendOptions): Promise<void>;
  abstract sendOperationalDigest(params: OperationalDigestEmailParams): Promise<void>;
}
