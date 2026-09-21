/** Fail closed before listen: DEV email must never serve a production process. */
import { isEmail } from 'class-validator';

export function assertProductionEmailConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const invalid: string[] = [];
  if (env.EMAIL_PROVIDER?.trim().toUpperCase() !== 'SMTP') invalid.push('EMAIL_PROVIDER');
  for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_NAME'] as const) {
    if (!env[name]?.trim()) invalid.push(name);
  }
  const port = env.SMTP_PORT?.trim() ?? '';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) invalid.push('SMTP_PORT');
  if (env.SMTP_SECURE !== 'true' && env.SMTP_SECURE !== 'false') invalid.push('SMTP_SECURE');
  const sender = env.SMTP_FROM_EMAIL?.trim() ?? '';
  if (!isEmail(sender, { require_tld: true, allow_display_name: false })) invalid.push('SMTP_FROM_EMAIL');
  let publicWebUrlValid = false;
  try {
    const url = new URL(env.PUBLIC_WEB_URL ?? '');
    publicWebUrlValid = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    // A missing/malformed public URL cannot be used in email links.
  }
  if (!publicWebUrlValid) invalid.push('PUBLIC_WEB_URL');
  if (invalid.length) throw new Error(`Production email configuration is invalid: ${invalid.join(', ')}`);
}

export function emailReadiness(env: NodeJS.ProcessEnv = process.env): 'ok' | 'development-only' | 'error' {
  if (env.NODE_ENV !== 'production') return env.EMAIL_PROVIDER?.trim().toUpperCase() === 'SMTP' ? 'ok' : 'development-only';
  try {
    assertProductionEmailConfigured(env);
    return 'ok';
  } catch {
    return 'error';
  }
}
