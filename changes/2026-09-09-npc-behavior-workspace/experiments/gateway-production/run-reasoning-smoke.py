"""Actual gateway HTTP pass-through; fake local provider, no inference or secret read."""
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parents[4]
received = []
class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass
    def do_POST(self):
        received.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        body = json.dumps({"id":"mock-reasoning", "model":"mock-pro", "choices":[{"index":0, "finish_reason":"stop", "message":{"role":"assistant","content":"ok"}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

provider = ThreadingHTTPServer(("0.0.0.0",0), Provider)
threading.Thread(target=provider.serve_forever, daemon=True).start()
with socket.socket() as candidate:
    candidate.bind(("127.0.0.1",0))
    port = candidate.getsockname()[1]
name = f"npc-reasoning-smoke-{os.getpid()}"
env = {key:value for key,value in os.environ.items() if not key.startswith(("MIDSCENE", "DEEPSEEK", "MODEL_"))}
env.update(DEEPSEEK_API_KEY="fake-provider", DEEPSEEK_API_BASE=f"http://host.docker.internal:{provider.server_port}/v1", MODEL_GATEWAY_TOKEN="fake-gateway", MODEL_FLASH_NAME="mock-flash", MODEL_PRO_NAME="mock-pro", MODEL_GATEWAY_PORT=str(port), MODEL_GATEWAY_CONTAINER_NAME=name)
with open("/tmp/npc-reasoning-smoke-gateway.log", "w") as log:
    process = subprocess.Popen(["bash", "scripts/model-gateway/start.sh"], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        for attempt in range(160):
            try:
                with urlopen(f"http://127.0.0.1:{port}/health/liveliness", timeout=1):
                    break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError("mock gateway exited")
                time.sleep(.1)
        body = {"model":"pro", "messages":[{"role":"user","content":"smoke"}], "reasoning_effort":"low", "max_tokens":32}
        request = Request(f"http://127.0.0.1:{port}/v1/chat/completions", data=json.dumps(body).encode(), headers={"Authorization":"Bearer fake-gateway", "Content-Type":"application/json"})
        with urlopen(request, timeout=15) as response:
            result = json.load(response)
        assert result["choices"][0]["message"]["content"] == "ok"
        assert len(received) == 1 and received[0]["reasoning_effort"] == "low"
        print(json.dumps({"pass":True, "providerCalls":len(received), "reasoningEffort":received[0]["reasoning_effort"], "realInference":0}))
    finally:
        subprocess.run(["docker","stop","--time","3",name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        process.wait(timeout=10)
        provider.shutdown()
