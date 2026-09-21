// @ts-check
const path = require('node:path');
const isProduction = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'Content-Security-Policy', value: [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:${isProduction ? '' : ' http://localhost:* http://127.0.0.1:*'}`,
    "font-src 'self' data:",
    `connect-src 'self' https:${isProduction ? '' : ' http://localhost:* http://127.0.0.1:* ws:'}`,
    "frame-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ') },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  ...(isProduction ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the managed-hosting runtime outside a hidden `.next` tree so the
  // build-to-runtime handoff does not depend on preserving hidden artifacts.
  distDir: 'next-build',
  output: 'standalone',
  // Monorepo root (platform/) so file tracing picks up hoisted npm
  // workspace dependencies instead of only apps/web's own node_modules.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
