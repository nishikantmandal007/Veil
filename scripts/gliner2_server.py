#!/usr/bin/env python3
"""
Local GLiNER2 inference bridge for the Privacy Shield extension.

The service binds to localhost by default and never forwards prompt text to any
external API except optional anonymization proxy requests made to a configured
endpoint from local `.env`.
"""

import argparse
import json
import os
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import urlparse

DEFAULT_MODEL = "fastino/gliner2-base-v1"
FALLBACK_MODELS = [
    "fastino/gliner2-multi-v1",
]
DEFAULT_THRESHOLD = 0.42
DEFAULT_MAX_CHARS = 9000
DEFAULT_LABELS = [
    "person",
    "email",
    "phone",
    "address",
    "ssn",
    "credit_card",
    "date_of_birth",
    "location",
    "organization",
]
REPO_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_DIR / ".env"
ANON_ENDPOINT_ENV_KEY = "MDP_ANONYMIZATION_ENDPOINT"
ANON_REQUEST_TIMEOUT_SEC = 10.0


def parse_simple_env_file(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not path.exists():
        return values

    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return values

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        if not key:
            continue

        cleaned = value.strip()
        if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
            cleaned = cleaned[1:-1]
        values[key] = cleaned

    return values


def resolve_anonymization_endpoint() -> str:
    direct = str(os.environ.get(ANON_ENDPOINT_ENV_KEY, "")).strip()
    if direct:
        return direct

    file_values = parse_simple_env_file(ENV_FILE)
    return str(file_values.get(ANON_ENDPOINT_ENV_KEY, "")).strip()


def extract_bearer_token(header_value: str) -> str:
    raw = str(header_value or "").strip()
    if not raw:
        return ""
    lower = raw.lower()
    if lower.startswith("bearer "):
        return raw[7:].strip()
    return raw


def mask_token(token: str) -> str:
    value = str(token or "")
    if not value:
        return "<empty>"
    if len(value) <= 12:
        return f"{value[:2]}***{value[-2:]}"
    return f"{value[:6]}...{value[-6:]}"


def compact_json(value: Any, max_chars: int = 6000) -> str:
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        encoded = repr(value)
    if len(encoded) <= max_chars:
        return encoded
    return f"{encoded[:max_chars]}...<truncated {len(encoded) - max_chars} chars>"


def log_anonymization(event: str, request_id: str, **fields: Any) -> None:
    payload = {"event": event, "request_id": request_id, **fields}
    print(f"[anonymize] {compact_json(payload)}", flush=True)


def proxy_anonymization(entries: List[Any], jwt_token: str, request_id: str) -> Any:
    if not isinstance(entries, list):
        raise ValueError("entries must be a JSON array.")
    if not entries:
        log_anonymization("skip.empty_entries", request_id, entries_count=0)
        return []

    token = str(jwt_token or "").strip()
    if not token:
        log_anonymization("error.missing_jwt", request_id, entries_count=len(entries))
        raise ValueError("Missing anonymization JWT token.")

    endpoint = resolve_anonymization_endpoint()
    if not endpoint:
        log_anonymization("error.missing_endpoint", request_id, env_key=ANON_ENDPOINT_ENV_KEY)
        raise RuntimeError(
            f"Missing {ANON_ENDPOINT_ENV_KEY}. Set it in .env or process environment."
        )

    log_anonymization(
        "request.outbound",
        request_id,
        endpoint=endpoint,
        jwt=mask_token(token),
        entries_count=len(entries),
        entries=entries,
    )

    request_body = json.dumps(entries).encode("utf-8")
    upstream = urlrequest.Request(
        endpoint,
        data=request_body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )

    try:
        with urlrequest.urlopen(upstream, timeout=ANON_REQUEST_TIMEOUT_SEC) as response:
            status_code = int(getattr(response, "status", 200))
            raw = response.read().decode("utf-8")
    except urlerror.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace").strip()
        except Exception:
            body = ""
        log_anonymization(
            "response.http_error",
            request_id,
            status=int(getattr(exc, "code", 0) or 0),
            body_preview=body[:1200],
        )
        detail = body[:320] if body else str(exc)
        raise RuntimeError(f"Upstream anonymization failed ({exc.code}): {detail}") from exc
    except urlerror.URLError as exc:
        log_anonymization("response.network_error", request_id, reason=str(exc.reason))
        raise RuntimeError(f"Unable to reach anonymization endpoint: {exc.reason}") from exc

    if not raw.strip():
        log_anonymization("response.empty", request_id, status=status_code)
        return []

    try:
        parsed = json.loads(raw)
        log_anonymization(
            "response.inbound",
            request_id,
            status=status_code,
            response=parsed,
        )
        return parsed
    except json.JSONDecodeError as exc:
        log_anonymization(
            "response.non_json",
            request_id,
            status=status_code,
            body_preview=raw[:1200],
        )
        raise RuntimeError("Anonymization endpoint returned non-JSON response.") from exc


def flatten_gliner2_output(raw_items: Any) -> List[Dict[str, Any]]:
    """
    Normalize GLiNER2 outputs into a flat list of entity-like dicts.

    GLiNER2 often returns:
      {"entities": {"person": [...], "email": [...]}}
    while older integrations may return:
      {"entities": [...]} or {"predictions": [...]}
    """
    if isinstance(raw_items, list):
        return [item for item in raw_items if isinstance(item, dict)]

    if not isinstance(raw_items, dict):
        return []

    entities = raw_items.get("entities")
    if isinstance(entities, list):
        return [item for item in entities if isinstance(item, dict)]

    if isinstance(entities, dict):
        flattened: List[Dict[str, Any]] = []
        for label, values in entities.items():
            if isinstance(values, dict):
                values = [values]
            elif isinstance(values, (str, tuple)):
                values = [values]
            elif not isinstance(values, list):
                continue

            for value in values:
                if isinstance(value, dict):
                    item = dict(value)
                    item.setdefault("label", str(label))
                    flattened.append(item)
                    continue

                if isinstance(value, str):
                    flattened.append({"label": str(label), "text": value})
                    continue

                if isinstance(value, (list, tuple)) and value:
                    # Backward-compat: (text, confidence, start, end)
                    item: Dict[str, Any] = {"label": str(label), "text": str(value[0])}
                    if len(value) > 1:
                        item["confidence"] = value[1]
                    if len(value) > 3 and isinstance(value[2], int) and isinstance(value[3], int):
                        item["start"] = value[2]
                        item["end"] = value[3]
                    flattened.append(item)

        return flattened

    predictions = raw_items.get("predictions")
    if isinstance(predictions, list):
        return [item for item in predictions if isinstance(item, dict)]

    return []


def extract_span(item: Dict[str, Any], text: str) -> Optional[Tuple[int, int]]:
    start = item.get("start", item.get("start_char"))
    end = item.get("end", item.get("end_char"))

    if isinstance(start, int) and isinstance(end, int) and end > start:
        return start, end

    span = item.get("span")
    if isinstance(span, (list, tuple)) and len(span) == 2:
        if isinstance(span[0], int) and isinstance(span[1], int) and span[1] > span[0]:
            return span[0], span[1]

    entity_text = str(
        item.get("text")
        or item.get("entity")
        or item.get("entity_text")
        or ""
    )
    if not entity_text:
        return None

    inferred = text.find(entity_text)
    if inferred < 0:
        return None
    return inferred, inferred + len(entity_text)


def extract_label(item: Dict[str, Any]) -> str:
    return str(
        item.get("label")
        or item.get("entity_group")
        or item.get("type")
        or ""
    ).strip().lower()


def extract_score(item: Dict[str, Any]) -> float:
    raw_score = item.get("score", item.get("confidence", item.get("probability", 0.0)))
    try:
        return float(raw_score)
    except (TypeError, ValueError):
        return 0.0


class GLiNERService:
    def __init__(self, model_name: str, default_threshold: float) -> None:
        self.model_name = model_name
        self.default_threshold = default_threshold
        self.model_source = model_name
        self.model = None
        self.backend = "gliner2"
        self.model_lock = threading.Lock()

    def resolve_local_snapshot(self, model_name: str) -> Optional[str]:
        model = str(model_name or "").strip()
        if not model:
            return None

        model_path = Path(model)
        if model_path.is_dir():
            return str(model_path)

        if "/" not in model:
            return None

        hub_root = (
            os.environ.get("HUGGINGFACE_HUB_CACHE")
            or os.environ.get("HF_HUB_CACHE")
            or os.environ.get("HF_HOME")
        )

        if hub_root:
            hub_dir = Path(hub_root)
        else:
            repo_dir = Path(__file__).resolve().parent.parent
            hub_dir = repo_dir / ".runtime" / "cache" / "hf" / "hub"

        if hub_dir.name != "hub":
            hub_dir = hub_dir / "hub"

        model_dir = hub_dir / f"models--{model.replace('/', '--')}"
        snapshots_dir = model_dir / "snapshots"
        refs_main = model_dir / "refs" / "main"

        preferred: List[Path] = []
        if refs_main.exists():
            revision = refs_main.read_text(encoding="utf-8", errors="ignore").strip()
            if revision:
                preferred.append(snapshots_dir / revision)

        if snapshots_dir.exists():
            others = [path for path in snapshots_dir.iterdir() if path.is_dir()]
            others.sort(key=lambda path: path.stat().st_mtime, reverse=True)
            preferred.extend(others)

        required = ("config.json", "tokenizer.json")
        for candidate in preferred:
            if all((candidate / item).exists() for item in required):
                return str(candidate)
        return None

    def load_model(self) -> None:
        if self.model is not None:
            return

        try:
            from gliner2 import GLiNER2
        except Exception as exc:
            raise RuntimeError(
                "GLiNER2 import failed. Reinstall local deps in the project venv: "
                "pip install -r requirements.txt"
            ) from exc

        candidates = [self.model_name] + [item for item in FALLBACK_MODELS if item != self.model_name]
        failures: List[Tuple[str, str]] = []
        for candidate in candidates:
            local_snapshot = self.resolve_local_snapshot(candidate)
            load_targets = []
            if local_snapshot:
                load_targets.append(local_snapshot)
            load_targets.append(candidate)

            for load_target in load_targets:
                try:
                    if load_target == candidate:
                        print(f"Loading GLiNER2 model ({self.backend}): {candidate}")
                    else:
                        print(f"Loading GLiNER2 model ({self.backend}) from local cache: {load_target}")
                    self.model = GLiNER2.from_pretrained(load_target)
                    self.model_name = candidate
                    self.model_source = load_target
                    print(f"GLiNER2 model loaded: {candidate} ({load_target})")
                    return
                except Exception as exc:
                    source_name = f"{candidate} via {load_target}"
                    failures.append((source_name, str(exc)))

        joined = " | ".join(f"{name}: {error}" for name, error in failures)
        if any(
            token in joined.lower()
            for token in ("401", "unauthorized", "repository not found", "invalid username or password")
        ):
            raise RuntimeError(
                "Model download failed (auth/repository issue). "
                f"Tried: {', '.join(candidates)}. "
                "Set a valid model id/path or configure Hugging Face auth (HF_TOKEN)."
            )
        raise RuntimeError(
            f"Model load failed. Tried: {', '.join(candidates)}. Last errors: {joined}"
        )

    def _predict(self, text: str, labels: List[str], threshold: float) -> List[Dict[str, Any]]:
        """
        Support GLiNER2 advanced API first, then fallback to older API shape.
        """
        if hasattr(self.model, "extract_entities"):
            attempts = [
                lambda: self.model.extract_entities(
                    text,
                    labels,
                    threshold=threshold,
                    format_results=True,
                    include_spans=True,
                    include_confidence=True,
                ),
                lambda: self.model.extract_entities(
                    text,
                    labels,
                    threshold=threshold,
                    include_spans=True,
                    include_confidence=True,
                ),
                lambda: self.model.extract_entities(text, labels, threshold=threshold, include_spans=True),
                lambda: self.model.extract_entities(text, labels, threshold=threshold),
                lambda: self.model.extract_entities(text, entity_types=labels, threshold=threshold),
                lambda: self.model.extract_entities(text, labels),
            ]
            for attempt in attempts:
                try:
                    return attempt()
                except TypeError:
                    continue
                except Exception:
                    continue

        if hasattr(self.model, "predict_entities"):
            attempts = [
                lambda: self.model.predict_entities(text, labels, threshold=threshold),
                lambda: self.model.predict_entities(text, labels),
            ]
            for attempt in attempts:
                try:
                    return attempt()
                except TypeError:
                    continue

        raise RuntimeError("Unsupported GLiNER model API: missing extract_entities/predict_entities")

    def detect(self, text: str, labels: List[str], threshold: float) -> List[Dict[str, Any]]:
        self.load_model()

        safe_labels = [str(label).strip().lower() for label in labels if str(label).strip()]
        if not safe_labels:
            safe_labels = DEFAULT_LABELS

        with self.model_lock:
            raw_items = self._predict(text, safe_labels, threshold)
        raw_items = flatten_gliner2_output(raw_items)

        detections: List[Dict[str, Any]] = []
        for item in raw_items:
            label = extract_label(item)
            if not label:
                continue

            span = extract_span(item, text)
            if span is None:
                continue

            start, end = span
            if start < 0 or end > len(text) or end <= start:
                continue

            detections.append(
                {
                    "text": text[start:end],
                    "label": label,
                    "start": start,
                    "end": end,
                    # Some GLiNER2 output formats omit confidence; keep it usable.
                    "score": max(extract_score(item), threshold),
                }
            )

        return detections


def make_handler(service: GLiNERService, max_chars: int):
    class Handler(BaseHTTPRequestHandler):
        def _write_json(self, payload: Any, status_code: int = 200) -> None:
            body = json.dumps(payload).encode("utf-8")
            try:
                self.send_response(status_code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                # Browser disconnected while we were sending response.
                pass

        def _read_json(self) -> Any:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                return {}
            raw = self.rfile.read(content_length).decode("utf-8")
            if not raw:
                return {}
            return json.loads(raw)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._write_json({}, status_code=204)

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path == "/health":
                self._write_json(
                    {
                        "ok": True,
                        "provider": "fastino-ai/GLiNER2",
                        "model": service.model_name,
                        "model_source": service.model_source,
                        "backend": service.backend,
                        "loaded": service.model is not None,
                        "anonymizationProxy": True,
                        "anonymizationEndpointConfigured": bool(resolve_anonymization_endpoint()),
                    }
                )
                return
            self._write_json({"ok": False, "error": "Not found"}, status_code=404)

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path

            try:
                payload = self._read_json()
                if path == "/detect":
                    text = str(payload.get("text", ""))
                    labels = payload.get("labels", DEFAULT_LABELS)
                    threshold = payload.get("threshold", service.default_threshold)

                    try:
                        threshold = float(threshold)
                    except (TypeError, ValueError):
                        threshold = service.default_threshold

                    if len(text) > max_chars:
                        text = text[:max_chars]

                    detections = service.detect(text, labels, threshold)
                    self._write_json({"ok": True, "detections": detections}, status_code=200)
                    return

                if path == "/anonymize":
                    request_id = uuid.uuid4().hex[:10]
                    entries = payload
                    jwt_token = ""
                    if isinstance(payload, dict):
                        entries = payload.get("entries", payload.get("payload", []))
                        jwt_token = str(payload.get("jwtToken", "")).strip()
                    if not jwt_token:
                        jwt_token = extract_bearer_token(self.headers.get("Authorization", ""))

                    input_count = len(entries) if isinstance(entries, list) else None
                    log_anonymization(
                        "route.inbound",
                        request_id,
                        has_inline_jwt=bool(jwt_token),
                        entries_count=input_count,
                    )

                    result = proxy_anonymization(entries, jwt_token, request_id)
                    self._write_json({"ok": True, "data": result}, status_code=200)
                    return

                self._write_json({"ok": False, "error": "Not found"}, status_code=404)
            except (BrokenPipeError, ConnectionResetError):
                # Client disconnected before receiving server output.
                return
            except json.JSONDecodeError:
                self._write_json({"ok": False, "error": "Invalid JSON body."}, status_code=400)
            except ValueError as exc:
                self._write_json({"ok": False, "error": str(exc)}, status_code=400)
            except RuntimeError as exc:
                self._write_json({"ok": False, "error": str(exc)}, status_code=502)
            except Exception as exc:
                self._write_json({"ok": False, "error": str(exc)}, status_code=500)

        def log_message(self, fmt: str, *args: Any) -> None:
            print(f"[gliner2-server] {self.address_string()} - {fmt % args}")

    return Handler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local GLiNER2 HTTP inference server")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Model id/path (default: {DEFAULT_MODEL})")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", default=8765, type=int, help="Bind port (default: 8765)")
    parser.add_argument("--threshold", default=DEFAULT_THRESHOLD, type=float, help="Default confidence threshold")
    parser.add_argument("--max-chars", default=DEFAULT_MAX_CHARS, type=int, help="Max chars per request")
    parser.add_argument(
        "--lazy-load",
        action="store_true",
        help="Do not load model at startup. Load only on first /detect request.",
    )
    parser.add_argument("--download-only", action="store_true", help="Download/cache model and exit")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    service = GLiNERService(args.model, args.threshold)

    if args.download_only:
        try:
            service.load_model()
        except Exception as exc:
            print(f"Model initialization error: {exc}", file=sys.stderr)
            raise SystemExit(2)
        print("Model download/cache complete")
        return

    if not args.lazy_load:
        print("Preloading GLiNER2 model into memory...")
        try:
            service.load_model()
        except Exception as exc:
            print(f"Model initialization error: {exc}", file=sys.stderr)
            raise SystemExit(2)
    else:
        print("Lazy-load mode enabled: model loads on first detection request.")

    handler = make_handler(service, args.max_chars)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"GLiNER2 local server listening on http://{args.host}:{args.port}")
    print("Endpoints: GET /health, POST /detect, POST /anonymize")
    server.serve_forever()


if __name__ == "__main__":
    main()
