from __future__ import annotations

import asyncio
import json
import unittest

from model_gateway.gateway_middleware import ModelGatewayMiddleware


class ReceiveDriver:
    def __init__(self, messages: list[dict] | None = None) -> None:
        self.messages: asyncio.Queue[dict] = asyncio.Queue()
        for message in messages or []:
            self.messages.put_nowait(message)

    async def __call__(self) -> dict:
        return await self.messages.get()

    def disconnect(self) -> None:
        self.messages.put_nowait({"type": "http.disconnect"})


class Sent(list[dict]):
    async def __call__(self, message: dict) -> None:
        self.append(message)


def request_scope(path: str = "/v1/chat/completions", method: str = "POST", length: int | None = None) -> dict:
    headers = [] if length is None else [(b"content-length", str(length).encode())]
    return {"type": "http", "path": path, "method": method, "headers": headers}


def body_message(model: str = "flash", *, more_body: bool = False, extra: dict | None = None) -> dict:
    body = json.dumps({"model": model, "messages": [], **(extra or {})}).encode()
    return {"type": "http.request", "body": body, "more_body": more_body}


async def response(send, status: int = 200) -> None:
    await send({"type": "http.response.start", "status": status, "headers": []})
    await send({"type": "http.response.body", "body": b"{}", "more_body": False})


class GatewayMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def test_defaults_preserve_product_bounds(self) -> None:
        gateway = ModelGatewayMiddleware(lambda *_: None)
        self.assertEqual(gateway.admission.capacity, 2)
        self.assertEqual(gateway.admission.pending_limit, 32)
        self.assertEqual(gateway.max_body_bytes, 4 * 1024 * 1024)
        self.assertEqual(gateway.tier_deadlines, {"flash": 60, "pro": 300})

    async def test_content_length_and_streaming_body_are_bounded(self) -> None:
        async def inner(*_) -> None:
            self.fail("oversized request reached LiteLLM")

        gateway = ModelGatewayMiddleware(inner)
        sent = Sent()

        async def forbidden_receive() -> dict:
            self.fail("Content-Length rejection read the body")

        await gateway(request_scope(length=gateway.max_body_bytes + 1), forbidden_receive, sent)
        self.assertEqual(sent[0]["status"], 413)

        sent.clear()
        driver = ReceiveDriver(
            [
                {"type": "http.request", "body": b"x" * gateway.max_body_bytes, "more_body": True},
                {"type": "http.request", "body": b"x", "more_body": False},
            ]
        )
        await gateway(request_scope(), driver, sent)
        self.assertEqual(sent[0]["status"], 413)

    async def test_body_limit_accepts_more_than_two_mib_of_history(self) -> None:
        payload = json.dumps(
            {"model": "flash", "messages": [{"role": "user", "content": "x" * (2 * 1024 * 1024)}]}
        ).encode()
        received = 0

        async def inner(scope, receive, send) -> None:
            nonlocal received
            message = await receive()
            received = len(message["body"])
            await response(send)

        gateway = ModelGatewayMiddleware(inner)
        sent = Sent()
        await gateway(
            request_scope(length=len(payload)),
            ReceiveDriver([{"type": "http.request", "body": payload, "more_body": False}]),
            sent,
        )
        self.assertGreater(received, 2 * 1024 * 1024)
        self.assertEqual(sent[0]["status"], 200)

    async def test_request_body_read_has_its_own_timeout(self) -> None:
        gateway = ModelGatewayMiddleware(lambda *_: None, body_timeout_seconds=0.01)
        sent = Sent()
        await gateway(request_scope(), ReceiveDriver(), sent)
        self.assertEqual(sent[0]["status"], 408)

    async def test_tier_total_deadline_includes_request_body_time(self) -> None:
        inner_called = False

        async def inner(*_) -> None:
            nonlocal inner_called
            inner_called = True

        first = True

        async def slow_receive() -> dict:
            nonlocal first
            if first:
                first = False
                await asyncio.sleep(0.03)
                return body_message()
            await asyncio.Future()

        gateway = ModelGatewayMiddleware(
            inner,
            body_timeout_seconds=1,
            tier_deadlines={"flash": 0.01, "pro": 0.2},
        )
        sent = Sent()
        await gateway(request_scope(), slow_receive, sent)
        self.assertEqual(sent[0]["status"], 504)
        self.assertFalse(inner_called)
        self.assertEqual(gateway.admission.active, 0)
        self.assertEqual(gateway.admission.waiting, 0)

    async def test_only_canonical_chat_and_health_routes_are_exposed(self) -> None:
        inner_calls: list[str] = []

        async def inner(scope, receive, send) -> None:
            inner_calls.append(scope["path"])
            if scope["path"] == "/v1/chat/completions":
                await receive()
            await response(send)

        gateway = ModelGatewayMiddleware(inner)
        rejected = [
            "/chat/completions",
            "/engines/flash/chat/completions",
            "/openai/deployments/flash/chat/completions",
            "/queue/chat/completions",
            "/v1/completions",
            "/v1/responses",
        ]
        for path in rejected:
            sent = Sent()
            await gateway(request_scope(path), ReceiveDriver(), sent)
            self.assertEqual(sent[0]["status"], 404)
        for path in ["/health/liveliness", "/health/readiness"]:
            await gateway(request_scope(path, "GET"), ReceiveDriver(), lambda _: asyncio.sleep(0))
        method_sent = Sent()
        await gateway(request_scope(method="GET"), ReceiveDriver(), method_sent)
        self.assertEqual(method_sent[0]["status"], 405)
        sent = Sent()
        await gateway(request_scope(), ReceiveDriver([body_message()]), sent)
        self.assertEqual(sent[0]["status"], 200)
        self.assertEqual(inner_calls, ["/health/liveliness", "/health/readiness", "/v1/chat/completions"])

    async def test_alias_and_gateway_owned_routing_are_enforced(self) -> None:
        async def inner(*_) -> None:
            self.fail("invalid routing request reached LiteLLM")

        gateway = ModelGatewayMiddleware(inner)
        for message in [
            body_message("unknown"),
            {"type": "http.request", "body": b'{"model":[]}', "more_body": False},
            body_message(extra={"num_retries": 9}),
            body_message(extra={"api_base": "http://example.invalid"}),
            body_message(extra={"fallbacks": [{"pro": ["flash"]}]}),
        ]:
            sent = Sent()
            await gateway(request_scope(), ReceiveDriver([message]), sent)
            self.assertEqual(sent[0]["status"], 400)

    async def test_total_deadline_cancels_inner_and_leaves_no_child_tasks(self) -> None:
        started = asyncio.Event()
        cleaned = asyncio.Event()

        async def inner(scope, receive, send) -> None:
            await receive()
            started.set()
            try:
                await asyncio.sleep(10)
            finally:
                cleaned.set()

        gateway = ModelGatewayMiddleware(inner, tier_deadlines={"flash": 0.02, "pro": 0.2})
        baseline = {task for task in asyncio.all_tasks() if task is not asyncio.current_task()}
        sent = Sent()
        await gateway(request_scope(), ReceiveDriver([body_message()]), sent)
        await asyncio.sleep(0)
        remaining = {task for task in asyncio.all_tasks() if task is not asyncio.current_task() and not task.done()}
        self.assertTrue(started.is_set())
        self.assertTrue(cleaned.is_set())
        self.assertEqual(sent[0]["status"], 504)
        self.assertEqual(gateway.admission.active, 0)
        self.assertEqual(remaining, baseline)

    async def test_pending_queue_overload_and_disconnect_release_all_state(self) -> None:
        release = asyncio.Event()
        starts = 0

        async def inner(scope, receive, send) -> None:
            nonlocal starts
            await receive()
            starts += 1
            if starts == 1:
                await release.wait()
            await response(send)

        gateway = ModelGatewayMiddleware(
            inner,
            concurrency=1,
            pending_limit=1,
            tier_deadlines={"flash": 1, "pro": 1},
        )
        first_sent = Sent()
        first = asyncio.create_task(gateway(request_scope(), ReceiveDriver([body_message()]), first_sent))
        while gateway.admission.active != 1:
            await asyncio.sleep(0)

        queued_driver = ReceiveDriver([body_message("pro")])
        queued_sent = Sent()
        queued = asyncio.create_task(gateway(request_scope(), queued_driver, queued_sent))
        while gateway.admission.waiting != 1:
            await asyncio.sleep(0)

        overloaded_sent = Sent()
        await gateway(request_scope(), ReceiveDriver([body_message()]), overloaded_sent)
        self.assertEqual(overloaded_sent[0]["status"], 429)

        queued_driver.disconnect()
        await queued
        self.assertEqual(queued_sent, [])
        self.assertEqual(gateway.admission.waiting, 0)
        self.assertEqual(gateway.admission.active, 1)

        release.set()
        await first
        await asyncio.sleep(0)
        self.assertEqual(first_sent[0]["status"], 200)
        self.assertEqual(gateway.admission.active, 0)
        self.assertEqual(gateway.admission.waiting, 0)

    async def test_outer_task_cancellation_cleans_inflight_children(self) -> None:
        started = asyncio.Event()
        cleaned = asyncio.Event()

        async def inner(scope, receive, send) -> None:
            await receive()
            started.set()
            try:
                await asyncio.sleep(10)
            finally:
                cleaned.set()

        gateway = ModelGatewayMiddleware(inner)
        baseline = {task for task in asyncio.all_tasks() if task is not asyncio.current_task()}
        task = asyncio.create_task(gateway(request_scope(), ReceiveDriver([body_message()]), Sent()))
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        await asyncio.sleep(0)
        remaining = {item for item in asyncio.all_tasks() if item is not asyncio.current_task() and not item.done()}
        self.assertTrue(cleaned.is_set())
        self.assertEqual(gateway.admission.active, 0)
        self.assertEqual(gateway.admission.waiting, 0)
        self.assertEqual(remaining, baseline)

    async def test_queue_deadline_cleans_unclaimed_acquire_task(self) -> None:
        release = asyncio.Event()
        first_started = asyncio.Event()

        async def inner(scope, receive, send) -> None:
            await receive()
            first_started.set()
            await release.wait()
            await response(send)

        gateway = ModelGatewayMiddleware(
            inner,
            concurrency=1,
            tier_deadlines={"flash": 0.02, "pro": 1},
        )
        first = asyncio.create_task(gateway(request_scope(), ReceiveDriver([body_message("pro")]), Sent()))
        await first_started.wait()
        sent = Sent()
        await gateway(request_scope(), ReceiveDriver([body_message("flash")]), sent)
        await asyncio.sleep(0)
        self.assertEqual(sent[0]["status"], 504)
        self.assertEqual(gateway.admission.active, 1)
        self.assertEqual(gateway.admission.waiting, 0)
        release.set()
        await first
        self.assertEqual(gateway.admission.active, 0)


if __name__ == "__main__":
    unittest.main()
