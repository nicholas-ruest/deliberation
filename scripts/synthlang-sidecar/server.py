"""SynthLang prompt-compression sidecar (ADR-039).

A minimal HTTP wrapper around the real `synthlang` PyPI package's
`FrameworkTranslator`. This platform's Node process never imports Python or
holds an LLM API key itself; it calls this sidecar over HTTP, exactly like
any other qualified external dependency (see
`src/platform/model-gateway/synthlang-compressor.ts` and
`docs/adr/ADR-039-compress-prompts-through-synthlang.md`).

Fails closed: /compress refuses with 503 immediately if OPENAI_API_KEY is not
set in this process's own environment, before ever constructing an LM client
or attempting network egress. That key is this sidecar's own adopter-supplied
configuration -- it is never read from, or passed through, the platform's
Node process.

No framework dependency (FastAPI/uvicorn) is required: this is deliberately
small enough for the standard library's http.server.
"""

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


def _estimate_tokens(text: str) -> int:
    # A whitespace-based estimate is intentionally conservative and dependency-free.
    # The real CLI (synthlang/cli.py) uses the same style of simple estimate for its
    # --show-metrics output; a tiktoken-exact count is not required for that purpose.
    return max(1, len(text.split()))


def _translate(text: str, instructions: str | None) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise PermissionError("OPENAI_API_KEY is not configured for this sidecar")

    import dspy
    from synthlang.core import FrameworkTranslator

    model = os.environ.get("SYNTHLANG_MODEL", "gpt-4o-mini")
    lm = dspy.LM(model=model, api_key=api_key)
    translator = FrameworkTranslator(lm=lm)
    result = translator(source_code=text, instructions=instructions)
    compressed = result["target"] if isinstance(result, dict) else result.target
    return {
        "original": text,
        "compressed": compressed,
        "originalTokens": _estimate_tokens(text),
        "compressedTokens": _estimate_tokens(compressed),
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (http.server's required method name)
        if self.path == "/health/live":
            self._json(200, {"status": "live"})
            return
        if self.path == "/health/ready":
            configured = bool(os.environ.get("OPENAI_API_KEY", ""))
            self._json(200 if configured else 503, {"status": "ready" if configured else "not-ready"})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/compress":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("content-length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON body"})
            return
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            self._json(400, {"error": "text is required"})
            return
        try:
            result = _translate(text, body.get("instructions"))
        except PermissionError as cause:
            self._json(503, {"error": str(cause)})
            return
        except Exception as cause:  # noqa: BLE001 -- surfaced to the caller, not swallowed
            self._json(502, {"error": f"translation failed: {cause}"})
            return
        self._json(200, result)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        pass  # keep stdout free of per-request access logs; errors still return in the response


def main() -> None:
    port = int(os.environ.get("PORT", "8137"))
    server = HTTPServer(("127.0.0.1", port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
