FROM node:20-alpine
WORKDIR /app
COPY services/storage-mcp-platform ./services/storage-mcp-platform
COPY packages ./packages
CMD ["node", "services/storage-mcp-platform/server.mjs"]
