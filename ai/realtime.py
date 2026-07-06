from __future__ import annotations
import logging
import asyncio
from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)

main_loop: asyncio.AbstractEventLoop | None = None

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        log.info(f"WebSocket client connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            log.info(f"WebSocket client disconnected. Total connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        try:
            from fastapi.encoders import jsonable_encoder
            safe_message = jsonable_encoder(message)
            await websocket.send_json(safe_message)
        except Exception as exc:
            log.error(f"Error sending personal message: {exc}")

    async def broadcast(self, message: dict):
        from fastapi.encoders import jsonable_encoder
        safe_message = jsonable_encoder(message)
        log.info(f"Broadcasting message: {safe_message} to {len(self.active_connections)} clients")
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(safe_message)
            except Exception as exc:
                log.error(f"Failed to broadcast to a connection, marking for removal: {exc}")
                disconnected.append(connection)
        
        for conn in disconnected:
            self.disconnect(conn)

manager = ConnectionManager()

def broadcast_event(event_type: str, data: dict):
    message = {"type": event_type, "data": data}
    global main_loop
    if main_loop is not None:
        try:
            asyncio.run_coroutine_threadsafe(manager.broadcast(message), main_loop)
            log.info(f"Scheduled broadcast event threadsafe: {event_type}")
        except Exception as exc:
            log.error(f"Failed to schedule threadsafe broadcast: {exc}")
    else:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(manager.broadcast(message))
            log.info(f"Scheduled broadcast event using running loop: {event_type}")
        except RuntimeError:
            log.warning("No main event loop or running loop found. Event not broadcasted.")


import os
from fastapi import APIRouter

router = APIRouter()

def _allowed_origins() -> set[str]:
    raw = os.environ.get("AI_CORS_ORIGINS", "*")
    if raw.strip() == "*":
        return set()          # empty set = allow all
    return {o.strip() for o in raw.split(",") if o.strip()}

@router.websocket("/realtime")
async def websocket_realtime_endpoint(websocket: WebSocket):
    # FastAPI CORSMiddleware does NOT protect WebSocket upgrades — check Origin manually.
    allowed = _allowed_origins()
    if allowed:
        origin = websocket.headers.get("origin", "")
        if origin not in allowed:
            log.warning(f"WebSocket connection rejected — disallowed origin: {origin!r}")
            await websocket.close(code=1008)  # Policy Violation
            return

    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as exc:
        log.error(f"WebSocket error: {exc}")
        manager.disconnect(websocket)
