🥋 Tournament Web Service

Веб-сервіс для управління турнірами з бойових мистецтв.

[![CI](https://github.com/gemnyl/TournamentSystem/actions/workflows/ci.yml/badge.svg)](https://github.com/gemnyl/TournamentSystem/actions/workflows/ci.yml)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=tournament-webservice&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=tournament-webservice)

## Tech Stack

| Layer | Tech |
|---|---|
| Backend API | Django 5, Django REST Framework |
| Real-time | Django Channels + Daphne (WebSocket) |
| Channel Layer | Redis |
| Database | PostgreSQL |
| Frontend | React 19, Vite, TypeScript, TailwindCSS |
| State | Zustand + TanStack Query |

---

## 🚀 Локальний запуск (покроково)

### 1. Клонуємо репозиторій
З GitHub:
```bash
git clone https://github.com/gemnyl/TournamentSystem.git
cd tournament-webservice
```
або з GitLab:
```bash
git clone https://git.ztu.edu.ua/ipz/2022-2026/ipz-22-3/muravytskyy-vladyslav/graduation-work.git
cd tournament-webservice
```
### 2. Налаштовуємо змінні оточення

```bash
cp backend/.env.example backend/.env
# Відредагуйте backend/.env — змініть DJANGO_SECRET_KEY на довільний рядок
```

### 3. Запускаємо інфраструктуру (PostgreSQL + Redis)

```bash
docker compose up -d db redis
```


### 4. Встановлюємо Python-залежності

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements-dev.txt
```

### 5. Застосовуємо міграції та завантажуємо демо-дані

```bash
python manage.py migrate
python manage.py loaddata fixtures/demo_data.json
```

### 6. Запускаємо Django (ASGI / Daphne)

```bash
python manage.py runserver
# або для WebSocket: daphne config.asgi:application
```

### 7. Запускаємо фронтенд

```bash
cd ../frontend
npm install
npm run dev
```

Фронтенд доступний за адресою: **http://localhost:5173**
API: **http://localhost:8000/api/**

---

## 👤 Demo-акаунти (з фікстури)

| Роль | Email | Пароль |
|---|---|---|
| Адміністратор | `admin@demo.test` | `demo12345` |
| Організатор | `organizer@demo.test` | `demo12345` |
| Тренер | `coach@demo.test` | `demo12345` |
| Суддя | `judge@demo.test` | `demo12345` |

---

## 🛠 Розробка

### Linting та форматування (бекенд)

```bash
cd backend
ruff check .          # перевірка
ruff format .         # форматування
```

### Тести (бекенд)

```bash
cd backend
pytest                # всі тести
pytest --cov=apps     # з покриттям
```

### Lint (фронтенд)

```bash
cd frontend
npm run lint          # ESLint
npm run build         # TypeScript build check
```

### Pre-commit hooks

```bash
pip install pre-commit
pre-commit install
```

Після цього `ruff` і `lint-staged` запускатимуться автоматично при кожному `git commit`.

---

## 🐳 Local development with Docker

Повне середовище (PostgreSQL + Redis + backend + frontend) запускається однією командою:

```bash
# 1. Скопіюй .env.example (за потреби змін — відредагуй)
cp backend/.env.example backend/.env

# 2. Збери образи та стартуй всі сервіси у фоні
docker compose up -d --build

# 3. Перевір liveness
curl http://localhost:8000/healthz/
# → {"status": "ok"}

# 4. Перевір readiness (БД + Redis)
curl http://localhost:8000/readyz/
# → {"status": "ok"}
```

| URL | Сервіс |
|---|---|
| `http://localhost` | Frontend (nginx → React SPA) |
| `http://localhost:8000/api/` | Backend REST API |
| `ws://localhost/ws/` | WebSocket (через nginx proxy) |
| `http://localhost:8000/admin/` | Django Admin |

### Запуск лише частини стеку

```bash
# Тільки інфраструктура (для локальної розробки без Docker-бекенду)
docker compose up -d db redis

# Зупинити і видалити контейнери (volumes збережуться)
docker compose down

# Повне очищення (включно з volumes)
docker compose down -v
```

### Health endpoints

| Endpoint | Призначення | Успішна відповідь |
|---|---|---|
| `GET /healthz/` | Liveness probe | `200 {"status": "ok"}` |
| `GET /readyz/` | Readiness probe (DB + Redis) | `200 {"status": "ok"}` або `503` з деталями |

## 📁 Структура проєкту

```
tournament-webservice/
├── .github/
│   └── workflows/
│       ├── ci.yml              # Lint + Test + Docker build
│       ├── sonar.yml           # SonarCloud аналіз
│       └── mirror-gitlab.yml   # Міроринг до університетського GitLab
├── backend/
│   ├── apps/
│   │   ├── accounts/           # Користувачі, клуби, ролі
│   │   ├── athletes/           # Профілі спортсменів
│   │   ├── common/             # Спільні утиліти (health endpoints)
│   │   ├── tournaments/        # Турніри, категорії, реєстрації
│   │   ├── matches/            # Матчі, WebSocket consumers
│   │   └── brackets/           # Генерація турнірних сіток
│   ├── config/                 # Django settings, urls, asgi
│   ├── fixtures/               # Demo data
│   ├── Dockerfile              # Multi-stage: builder → runtime (daphne)
│   ├── .dockerignore
│   ├── requirements.txt
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── pages/              # Сторінки (React Router)
│   │   ├── components/         # UI-компоненти
│   │   ├── stores/             # Zustand stores
│   │   └── lib/                # API client, utils
│   ├── Dockerfile              # Multi-stage: node builder → nginx runtime
│   ├── nginx.conf              # SPA fallback + /api + /ws proxy
│   ├── .dockerignore
│   └── package.json
├── docker-compose.yml          # Локальне середовище
└── sonar-project.properties    # SonarCloud конфіг
```
