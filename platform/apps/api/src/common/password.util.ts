import * as argon2 from 'argon2';
import { authConfig } from '../config/auth.config';

/** يُنتج Argon2id encoded hash كاملًا (يتضمن الملح وpameters — سلسلة واحدة قابلة للتحقق لاحقًا بلا حاجة لتخزين ملح منفصل). */
export function hashSecret(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: authConfig.argon2.memoryCost,
    timeCost: authConfig.argon2.timeCost,
    parallelism: authConfig.argon2.parallelism,
  });
}

/** تحقق آمن (constant-time داخليًا في argon2) — لا يرمي عند عدم التطابق، يعيد false فقط. */
export async function verifySecret(encodedHash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(encodedHash, plain);
  } catch {
    return false;
  }
}
