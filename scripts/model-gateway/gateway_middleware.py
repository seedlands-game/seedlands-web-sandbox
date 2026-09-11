"""Bounded ASGI admission and cancellation boundary for the local model gateway."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
AsgiApp = Callable[[Message, Receive, Send], Awaitable[None]]

CHAT_PATH = "/v1/chat/completions"
HEALTH_PATHS = frozenset({"/health/liveliness", "/health/readiness"})
MODEL_ALIASES = frozenset({"flash", "pro"})
ROUTING_OVERRIDE_FIELDS = frozenset(
    {
        "api_base",
        "api_key",
        "base_url",
        "context_window_fallbacks",
        "custom_llm_provider",
        "deployment",
        "deployment_id",
        "fallbacks",
        "max_retries",
        "model_group_alias",
        "model_list",
        "num_retries",
        "retry_policy",
    }
)


class ClientDisconnected(Exception):
    pass


class RequestBodyTimeout(Exception):
    pass


class RequestBodyTooLarge(Exception):
    pass


class InvalidContentLength(Exception):
    pass


class TotalDeadlineExceeded(Exception):
    pass


@dataclass
class AdmissionLease:
    owner: "SharedAdmission"
    released: bool = False

    async def release(self) -> None:
        if self.released:
            return
        self.released = True
        await self.owner.release()


class SharedAdmission:
    def __init__(self, capacity: int, pending_limit: int) -> None:
        if capacity < 1 or pending_limit < 0:
            raise ValueError("invalid admission limits")
        self.capacity = capacity
        self.pending_limit = pending_limit
        self.active = 0
        self.waiting = 0
        self.changed = asyncio.Condition()

    async def acquire(self) -> AdmissionLease | None:
        async with self.changed:
            if self.active < self.capacity:
                self.active += 1
                return AdmissionLease(self)
            if self.waiting >= self.pending_limit:
                return None
            self.waiting += 1
            try:
                await self.changed.wait_for(lambda: self.active < self.capacity)
                self.active += 1
                return AdmissionLease(self)
            finally:
                self.waiting -= 1

    async def release(self) -> None:
        async with self.changed:
            if self.active < 1:
                raise RuntimeError("admission release without active lease")
            self.active -= 1
            self.changed.notify(1)


async def cancel_and_wait(*tasks: asyncio.Task[Any] | None) -> None:
    pending = [task for task in tasks if task is not None]
    for task in pending:
        if not task.done():
            task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


class ModelGatewayMiddleware:
    def __init__(
        self,
        inner: AsgiApp,
        *,
        concurrency: int = 2,
        pending_limit: int = 32,
        max_body_bytes: int = 4 * 1024 * 1024,
        body_timeout_seconds: float = 10,
        tier_deadlines: Mapping[str, float] | None = None,
    ) -> None:
        if max_body_bytes < 2 * 1024 * 1024 or body_timeout_seconds <= 0:
            raise ValueError("invalid request bounds")
        self.inner = inner
        self.admission = SharedAdmission(concurrency, pending_limit)
        self.max_body_bytes = max_body_bytes
        self.body_timeout_seconds = body_timeout_seconds
        self.tier_deadlines = dict(tier_deadlines or {"flash": 60, "pro": 300})
        if set(self.tier_deadlines) != MODEL_ALIASES or any(value <= 0 for value in self.tier_deadlines.values()):
            raise ValueError("tier deadlines must define positive flash and pro values")

    async def _send_json(
        self,
        send: Send,
        status: int,
        message: str,
        *,
        retry_after: bool = False,
        allow: bytes | None = None,
    ) -> None:
        body = json.dumps(
            {"error": {"message": message, "type": "model_gateway_error"}},
            separators=(",", ":"),
        ).encode()
        headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
        if retry_after:
            headers.append((b"retry-after", b"1"))
        if allow is not None:
            headers.append((b"allow", allow))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body, "more_body": False})

    def _content_length(self, scope: Message) -> int | None:
        values = [value for key, value in scope.get("headers", []) if key.lower() == b"content-length"]
        if not values:
            return None
        if len(values) != 1:
            raise InvalidContentLength
        try:
            length = int(values[0])
        except ValueError as error:
            raise InvalidContentLength from error
        if length < 0:
            raise InvalidContentLength
        return length

    async def _read_body(self, scope: Message, receive: Receive) -> bytes:
        content_length = self._content_length(scope)
        if content_length is not None and content_length > self.max_body_bytes:
            raise RequestBodyTooLarge
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                raise ClientDisconnected
            if message["type"] != "http.request":
                continue
            body.extend(message.get("body", b""))
            if len(body) > self.max_body_bytes:
                raise RequestBodyTooLarge
            if not message.get("more_body", False):
                return bytes(body)

    async def _monitor_disconnect(self, receive: Receive, disconnected: asyncio.Event) -> None:
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                disconnected.set()
                return

    async def _acquire_before(
        self,
        expires_at: float,
        disconnected: asyncio.Event,
    ) -> AdmissionLease | None:
        lease_task = asyncio.create_task(self.admission.acquire())
        disconnect_task = asyncio.create_task(disconnected.wait())
        claimed: AdmissionLease | None = None
        try:
            remaining = expires_at - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise TotalDeadlineExceeded
            done, _ = await asyncio.wait(
                {lease_task, disconnect_task},
                timeout=remaining,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                raise TotalDeadlineExceeded
            if disconnected.is_set():
                raise ClientDisconnected
            claimed = await lease_task
            return claimed
        finally:
            await cancel_and_wait(disconnect_task)
            if not lease_task.done():
                await cancel_and_wait(lease_task)
            elif claimed is None and not lease_task.cancelled() and lease_task.exception() is None:
                orphaned = lease_task.result()
                if orphaned is not None:
                    await orphaned.release()

    async def _run_before(
        self,
        expires_at: float,
        disconnected: asyncio.Event,
        scope: Message,
        receive: Receive,
        send: Send,
    ) -> None:
        inner_task = asyncio.create_task(self.inner(scope, receive, send))
        disconnect_task = asyncio.create_task(disconnected.wait())
        try:
            remaining = expires_at - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise TotalDeadlineExceeded
            done, _ = await asyncio.wait(
                {inner_task, disconnect_task},
                timeout=remaining,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                raise TotalDeadlineExceeded
            if inner_task in done:
                await inner_task
                return
            raise ClientDisconnected
        finally:
            await cancel_and_wait(inner_task, disconnect_task)

    async def __call__(self, scope: Message, receive: Receive, send: Send) -> None:
        scope_type = scope.get("type")
        if scope_type == "lifespan":
            await self.inner(scope, receive, send)
            return
        if scope_type == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if scope_type != "http":
            return

        path = scope.get("path")
        method = scope.get("method")
        if method == "GET" and path in HEALTH_PATHS:
            await self.inner(scope, receive, send)
            return
        if path != CHAT_PATH:
            await self._send_json(send, 404, "unsupported model gateway route")
            return
        if method != "POST":
            await self._send_json(send, 405, "chat completions requires POST", allow=b"POST")
            return

        started_at = asyncio.get_running_loop().time()
        try:
            async with asyncio.timeout(self.body_timeout_seconds):
                body = await self._read_body(scope, receive)
        except ClientDisconnected:
            return
        except InvalidContentLength:
            await self._send_json(send, 400, "invalid Content-Length")
            return
        except RequestBodyTooLarge:
            await self._send_json(send, 413, "request body exceeds model gateway limit")
            return
        except TimeoutError:
            await self._send_json(send, 408, "request body deadline exceeded")
            return

        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            await self._send_json(send, 400, "request body must be valid JSON")
            return
        if not isinstance(payload, dict):
            await self._send_json(send, 400, "request body must be a JSON object")
            return
        model = payload.get("model")
        if not isinstance(model, str) or model not in MODEL_ALIASES:
            await self._send_json(send, 400, "model must be flash or pro")
            return
        overridden = sorted(ROUTING_OVERRIDE_FIELDS.intersection(payload))
        if overridden:
            await self._send_json(send, 400, "request cannot override gateway routing or retries")
            return

        expires_at = started_at + self.tier_deadlines[model]
        disconnected = asyncio.Event()
        monitor_task = asyncio.create_task(self._monitor_disconnect(receive, disconnected))
        lease: AdmissionLease | None = None
        response_started = False
        replayed = False

        async def replay_receive() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            await disconnected.wait()
            return {"type": "http.disconnect"}

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            lease = await self._acquire_before(expires_at, disconnected)
            if lease is None:
                await self._send_json(tracked_send, 429, "model gateway pending queue is full", retry_after=True)
                return
            await self._run_before(expires_at, disconnected, scope, replay_receive, tracked_send)
        except ClientDisconnected:
            return
        except TotalDeadlineExceeded:
            if not response_started and not disconnected.is_set():
                await self._send_json(tracked_send, 504, "model gateway total request deadline exceeded")
        finally:
            await cancel_and_wait(monitor_task)
            if lease is not None:
                await lease.release()
