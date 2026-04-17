# ── Guardian Backend — Production Dockerfile ─────────────────────────────────
# Multi-stage build keeps the final image lean (~200 MB vs ~800 MB).
# Runs as a non-root user for container security.
#
# Build:  docker build -t guardian-backend ./backend
# Run:    docker run --env-file backend/.env -p 8000:8000 guardian-backend

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build tools needed by some wheels (bcrypt, cryptography, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install --prefix=/install --no-cache-dir -r requirements.txt


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Non-root user — least privilege
RUN addgroup --system guardian && adduser --system --ingroup guardian guardian

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY --chown=guardian:guardian . .

# Create directory for SQLite files (volume-mounted in docker-compose)
RUN mkdir -p /data && chown guardian:guardian /data
ENV DB_DIR=/data

USER guardian

EXPOSE 8000

# Uvicorn: 1 worker per container is the Docker-native pattern.
# Scale horizontally via docker-compose --scale or k8s replicas.
# --no-access-log keeps stdout clean; real request logging is handled by FastAPI middleware.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--no-access-log"]
