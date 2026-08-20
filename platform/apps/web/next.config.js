// @ts-check
const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the managed-hosting runtime outside a hidden `.next` tree so the
  // build-to-runtime handoff does not depend on preserving hidden artifacts.
  distDir: 'next-build',
  output: 'standalone',
  experimental: {
    // Monorepo root (platform/) so file tracing picks up hoisted npm
    // workspace dependencies instead of only apps/web's own node_modules.
    outputFileTracingRoot: path.join(__dirname, '..', '..'),
  },
};

module.exports = nextConfig;
