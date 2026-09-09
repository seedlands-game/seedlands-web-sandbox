"""Narrow ASGI admission/deadline compatibility layer for LiteLLM 1.100.0."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from typing import Any

from litellm.proxy.proxy_server import app as litellm_app

Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]


class SharedAdmission:
    def __init__(self, capacity: int, queue_limit: int) -> None:
        self.capacity = capacity
        self.queue_limit = queue_limit
        self.active = 0
        self.waiting = 0
        self.changed = asyncio.Condition()

    async def acquire(self) -> str:
        async with self.changed:
            if self.active < self.capacity:
                self.active += 1
                return "acquired"
            if self.waiting >= self.queue_limit:
                return "overloaded"
            self.waiting += 1
            try:
                await self.changed.wait_for(lambda: self.active < self.capacity)
                self.active += 1
                return "acquired"
            finally:
                self.waiting -= 1

    async def release(self) -> None:
        async with self.changed:
            self.active -= 1
            self.changed.notify(1)


class GatewayCompatibilityMiddleware:
    def __init__(self, inner: Callable[..., Awaitable[None]], capacity: int, queue_limit: int, deadline: float) -> None:
        self.inner = inner
        self.admission = SharedAdmission(capacity, queue_limit)
        self.deadline = deadline

    async def _json_error(self, send: Send, status: int, message: str, retry_after: bool = False) -> None:
        body = json.dumps({"error": {"message": message, "type": "gateway_admission_error"}}).encode()
        headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
        if retry_after:
            headers.append((b"retry-after", b"1"))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: Message, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http" or scope.get("method") != "POST" or scope.get("path") != "/v1/chat/completions":
            await self.inner(scope, receive, send)
            return

        loop = asyncio.get_running_loop()
        expires_at = loop.time() + self.deadline
        request_body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            request_body.extend(message.get("body", b""))
            if not message.get("more_body", False):
                break

        disconnected = asyncio.Event()

        async def monitor_disconnect() -> None:
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    disconnected.set()
                    return

        monitor = asyncio.create_task(monitor_disconnect())
        acquired = False
        response_started = False
        acquire_task: asyncio.Task[str] | None = None
        inner_task: asyncio.Task[None] | None = None

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        replayed = False

        async def replay_receive() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(request_body), "more_body": False}
            await disconnected.wait()
            return {"type": "http.disconnect"}

        try:
            async with asyncio.timeout_at(expires_at):
                acquire_task = asyncio.create_task(self.admission.acquire())
                disconnect_task = asyncio.create_task(disconnected.wait())
                done, _ = await asyncio.wait({acquire_task, disconnect_task}, return_when=asyncio.FIRST_COMPLETED)
                if disconnect_task in done:
                    acquire_task.cancel()
                    await asyncio.gather(acquire_task, return_exceptions=True)
                    return
                disconnect_task.cancel()
                result = await acquire_task
                if result == "overloaded":
                    await self._json_error(tracked_send, 429, "gateway pending queue is full", retry_after=True)
                    return
                acquired = True

                inner_task = asyncio.create_task(self.inner(scope, replay_receive, tracked_send))
                disconnect_task = asyncio.create_task(disconnected.wait())
                done, _ = await asyncio.wait({inner_task, disconnect_task}, return_when=asyncio.FIRST_COMPLETED)
                if disconnect_task in done:
                    inner_task.cancel()
                    await asyncio.gather(inner_task, return_exceptions=True)
                    return
                disconnect_task.cancel()
                await inner_task
        except TimeoutError:
            if inner_task is not None and not inner_task.done():
                inner_task.cancel()
                await asyncio.gather(inner_task, return_exceptions=True)
            if not response_started and not disconnected.is_set():
                await self._json_error(tracked_send, 504, "gateway total request deadline exceeded")
        finally:
            if inner_task is not None and not inner_task.done():
                inner_task.cancel()
                await asyncio.gather(inner_task, return_exceptions=True)
            if acquire_task is not None and not acquire_task.done():
                acquire_task.cancel()
                await asyncio.gather(acquire_task, return_exceptions=True)
            elif acquire_task is not None and not acquired and not acquire_task.cancelled():
                if acquire_task.exception() is None and acquire_task.result() == "acquired":
                    acquired = True
            monitor.cancel()
            await asyncio.gather(monitor, return_exceptions=True)
            if acquired:
                await self.admission.release()


app = GatewayCompatibilityMiddleware(
    litellm_app,
    capacity=int(os.environ.get("GATEWAY_PROVIDER_CONCURRENCY", "2")),
    queue_limit=int(os.environ.get("GATEWAY_PENDING_LIMIT", "32")),
    deadline=float(os.environ.get("GATEWAY_TOTAL_DEADLINE_SECONDS", "5")),
)
