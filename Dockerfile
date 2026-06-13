# Base image: defaults to the PUBLIC Docker Hub image (used by Railway / any cloud host).
# Locally (behind the corporate network) docker-compose overrides NODE_IMAGE to the internal
# registry. The npmrc secret is optional — if not provided (cloud), npm uses the public registry.
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- Stage 1: build frontend ----------
FROM ${NODE_IMAGE} AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm install
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: build backend ----------
FROM ${NODE_IMAGE} AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm install
COPY backend/ ./
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV DATA_DIR=/app/data

# backend production deps only (express + cors, both pure JS)
COPY backend/package.json backend/package-lock.json* ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm install --omit=dev

# compiled backend + built frontend
COPY --from=backend /app/backend/dist ./dist
COPY --from=frontend /app/frontend/dist ./public

EXPOSE 3100
VOLUME ["/app/data"]
CMD ["node", "--experimental-sqlite", "dist/index.js"]
