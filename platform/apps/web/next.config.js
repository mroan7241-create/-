// @ts-check
const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    // Monorepo root (platform/) so file tracing picks up hoisted npm
    // workspace dependencies instead of only apps/web's own node_modules.
    outputFileTracingRoot: path.join(__dirname, '..', '..'),
  },
};

module.exports = nextConfig;
