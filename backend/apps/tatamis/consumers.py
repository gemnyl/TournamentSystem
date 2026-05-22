import asyncio
import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from apps.common.broadcast import broadcast_timer_state
from apps.tatamis.services import TatamiService


class TatamiConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.tournament_id = self.scope["url_route"]["kwargs"]["tournament_id"]
        self.tatami_number = self.scope["url_route"]["kwargs"]["tatami_number"]
        self.group_name = f"tatami_{self.tournament_id}_{self.tatami_number}"

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        snapshot = await sync_to_async(TatamiService.get_snapshot)(
            self.tournament_id, self.tatami_number
        )
        await self.send(text_data=json.dumps({"type": "tatami.snapshot", "data": snapshot}))

        self._heartbeat = asyncio.ensure_future(self._timer_heartbeat())

    async def disconnect(self, close_code):
        if hasattr(self, "_heartbeat"):
            self._heartbeat.cancel()
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if text_data:
            try:
                msg = json.loads(text_data)
                if msg.get("type") == "ping":
                    await self.send(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass

    async def _timer_heartbeat(self):
        """Кожні 5 с надсилає timer.state якщо таймер running (drift correction)."""
        while True:
            await asyncio.sleep(5)
            match = await sync_to_async(TatamiService.get_current_match)(
                self.tournament_id, self.tatami_number
            )
            if match and match.timer_status == "running":
                await sync_to_async(broadcast_timer_state)(match)

    # ------------------------------------------------------------------
    # Channel layer handlers
    # ------------------------------------------------------------------

    async def match_event(self, event):
        await self.send(text_data=json.dumps(event))

    async def timer_state(self, event):
        await self.send(text_data=json.dumps(event))

    async def tatami_state(self, event):
        await self.send(text_data=json.dumps(event))
