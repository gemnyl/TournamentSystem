# ─── Stage 1: node builder ───────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Копіюємо маніфести та встановлюємо залежності (кеш-шар)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Копіюємо решту і збираємо production bundle
COPY . .
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npx vite build

# ─── Stage 2: nginx runtime ──────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Замінюємо конфіг за замовчуванням
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Кладемо зібраний фронт
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
