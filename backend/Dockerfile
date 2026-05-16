# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /build

COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/root/.local/bin:$PATH

# libpq5  — psycopg runtime dependency
# curl    — HEALTHCHECK та debug
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

# Копіюємо встановлені пакети з builder-стадії
COPY --from=builder /root/.local /root/.local

WORKDIR /app
COPY . .

# Збираємо статику (DJANGO_SECRET_KEY потрібна, бо settings.py її перевіряє)
RUN DJANGO_SECRET_KEY="collect-static-placeholder" \
    DJANGO_DEBUG="False" \
    DB_HOST="localhost" \
    python manage.py collectstatic --noinput

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/healthz/ || exit 1

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
