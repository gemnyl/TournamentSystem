"""
WebSocket consumer для real-time трансляції подій матчів.

Клієнт підключається по URL ws/category/<category_id>/
і отримує повідомлення типу:
  {
    "type": "match.event",
    "match_id": 42,
    "event": {"sequence": 7, "event_type": "score", "payload": {...}},
    "match": { ...MatchSerializer... }
  }
"""

import json

from channels.generic.websocket import AsyncWebsocketConsumer


class MatchConsumer(AsyncWebsocketConsumer):
    """Асинхронний WebSocket consumer для трансляції подій категорії."""

    async def connect(self):
        self.category_id = self.scope["url_route"]["kwargs"]["category_id"]
        self.group_name = f"category_{self.category_id}"

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if text_data:
            try:
                message = json.loads(text_data)
                if message.get("type") == "ping":
                    await self.send(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass

    # ------------------------------------------------------------------
    # Обробники повідомлень від channel layer
    # ------------------------------------------------------------------

    async def match_event(self, event):
        """Отримує {type: 'match.event', match_id, event, match} і пересилає клієнту."""
        await self.send(
            text_data=json.dumps(
                {
                    "type": "match.event",
                    "match_id": event["match_id"],
                    "event": event["event"],
                    "match": event["match"],
                }
            )
        )
