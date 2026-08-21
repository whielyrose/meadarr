# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Final image ───────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY backend/ .

# Copy built frontend into backend's static serving directory
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

# Create data directories
RUN mkdir -p /app/data /music /slskd-downloads

# Run as non-root
RUN useradd -m -u 1000 meadarr && chown -R meadarr:meadarr /app
USER meadarr

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8090/health')"

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]
