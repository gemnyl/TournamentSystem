import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from apps.tatamis.services import TatamiService


class TatamiConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.tournament_id = self.scope["url_route"]["kwargs"]["tournament_id"]
        self.tatami_number = self.scope["url_route"]["kwargs"]["tatami_number"]
        self.group_name = f"tatami_{self.tournament_id}_{self.tatami_number}"

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        import time

        snapshot = await sync_to_async(TatamiService.get_snapshot)(
            self.tournament_id, self.tatami_number
        )
        await self.send(
            text_data=json.dumps(
                {
                    "type": "tatami.snapshot",
                    "server_ts_ms": int(time.time() * 1000),
                    "data": snapshot,
                }
            )
        )

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if text_data:
            try:
                msg = json.loads(text_data)
                if msg.get("type") == "ping":
                    import time

                    await self.send(
                        text_data=json.dumps(
                            {
                                "type": "pong",
                                "server_ts_ms": int(time.time() * 1000),
                            }
                        )
                    )
            except json.JSONDecodeError:
                pass

    # ------------------------------------------------------------------
    # Channel layer handlers
    # ------------------------------------------------------------------

    async def match_event(self, event):
        await self.send(text_data=json.dumps(event))

    async def timer_state(self, event):
        await self.send(text_data=json.dumps(event))

    async def tatami_state(self, event):
        await self.send(text_data=json.dumps(event))
