"""
WSGI-точка входу (для gunicorn або іншого WSGI-сервера без WebSocket).

Для повноцінної роботи з WebSocket використовуйте ASGI (config/asgi.py).
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_wsgi_application()
