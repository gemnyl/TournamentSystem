"""
WebSocket consumer для real-time трансляції оновлень матчів.

Клієнт підключається по URL ws/category/<category_id>/
і отримує повідомлення типу {type: "match_update", data: <MatchSerializer>}
щоразу, коли суддя оновлює рахунок або фіксує переможця через REST API.
"""
import json

from channels.generic.websocket import AsyncWebsocketConsumer


class MatchConsumer(AsyncWebsocketConsumer):
    """Асинхронний WebSocket consumer для трансляції подій категорії."""

    async def connect(self):
        """Підключення: входимо до групи категорії."""
        self.category_id = self.scope['url_route']['kwargs']['category_id']
        self.group_name = f'category_{self.category_id}'

        # Приєднуємось до групи channel layer
        await self.channel_layer.group_add(
            self.group_name,
            self.channel_name,
        )
        await self.accept()

    async def disconnect(self, close_code):
        """Відключення: виходимо з групи."""
        await self.channel_layer.group_discard(
            self.group_name,
            self.channel_name,
        )

    async def receive(self, text_data=None, bytes_data=None):
        """Клієнт може надсилати ping — відповідаємо pong (keepalive)."""
        if text_data:
            try:
                message = json.loads(text_data)
                if message.get('type') == 'ping':
                    await self.send(json.dumps({'type': 'pong'}))
            except json.JSONDecodeError:
                pass

    # ------------------------------------------------------------------
    # Обробники повідомлень від channel layer
    # ------------------------------------------------------------------

    async def match_update(self, event):
        """Отримує {type: 'match.update', data: {...}} і пересилає клієнту."""
        await self.send(text_data=json.dumps({
            'type': 'match_update',
            'data': event['data'],
        }))