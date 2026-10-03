// Synthetic key for isolated Jest units only; never used by the application runtime.
if (process.env.NODE_ENV !== 'test') throw new Error('UNIT_MAIL_ENV_REQUIRES_TEST');
process.env.EMAIL_DELIVERY_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString('base64');
