FROM node:20-alpine
WORKDIR /app
COPY apps/dashboard ./apps/dashboard
COPY packages ./packages
CMD ["node", "apps/dashboard/server.mjs"]
