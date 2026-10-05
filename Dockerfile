FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

# Build details, passed in by Jenkins with --build-arg. The website shows them.
ARG BUILD_NUMBER=local
ARG GIT_COMMIT=dev
ARG BUILD_TIME=unknown
ENV BUILD_NUMBER=$BUILD_NUMBER \
    GIT_COMMIT=$GIT_COMMIT \
    BUILD_TIME=$BUILD_TIME \
    NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Run as the unprivileged "node" user (uid 1000), which the Kubernetes manifest expects
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "src/server.js"]
