FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY services/storage-mcp-platform ./services/storage-mcp-platform
COPY packages ./packages
CMD ["node", "services/storage-mcp-platform/server.mjs"]
