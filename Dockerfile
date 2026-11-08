FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY schema ./schema
COPY workers ./workers
COPY infra/scripts ./infra/scripts
ENV PORT=8787
ENV TICKETS_DATA_DIR=/data/tickets
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "workers/intake/server.mjs"]
