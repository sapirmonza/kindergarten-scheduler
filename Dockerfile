# Cloud / Railway Dockerfile — uses the PUBLIC Docker Hub image and the public npm registry.
# (No BuildKit secret mounts and no VOLUME instruction — Railway's builder doesn't support them;
#  persistence is provided by a Railway Volume mounted at /app/data.)
# For LOCAL builds behind the corporate network, docker-compose uses Dockerfile.local instead.

# ---------- Stage 1: build frontend ----------
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: build backend ----------
FROM node:22-bookworm-slim AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/ ./
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV DATA_DIR=/app/data

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY --from=backend /app/backend/dist ./dist
COPY --from=frontend /app/frontend/dist ./public

EXPOSE 3100
CMD ["node", "--experimental-sqlite", "dist/index.js"]
