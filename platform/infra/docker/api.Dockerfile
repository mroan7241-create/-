# NODE-0: صورة تطوير بسيطة — بلا تحسين multi-stage/production بعد (خارج نطاق هذه المرحلة).
FROM node:24-slim

WORKDIR /workspace

COPY package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json

RUN npm install --workspaces --include-workspace-root

COPY . .

RUN npm run build --workspace packages/shared \
  && npm run prisma:generate --workspace packages/db \
  && npm run build --workspace packages/db \
  && npm run build --workspace apps/api

EXPOSE 3001
CMD ["node", "apps/api/dist/src/main.js"]
