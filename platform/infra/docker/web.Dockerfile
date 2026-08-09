# NODE-0: صورة تطوير بسيطة — بلا تحسين multi-stage/production بعد (خارج نطاق هذه المرحلة).
FROM node:24-slim

WORKDIR /workspace

COPY package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install --workspaces --include-workspace-root

COPY . .

RUN npm run build --workspace packages/shared \
  && npm run build --workspace apps/web

EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "apps/web"]
