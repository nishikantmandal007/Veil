#!/usr/bin/env python3
"""
Native messaging host for Privacy Shield.

This host allows the Chrome extension to start/stop/check the local GLiNER2
server process. It can also bootstrap dependencies on first run.
"""

import json
import os
import signal
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict

HOST_NAME = "com.privacyshield.gliner2"
SERVER_URL = "http://127.0.0.1:8765/health"
WAIT_SECONDS = 18
MODEL_ENV_VAR = "GLINER2_MODEL"

REPO_DIR = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_DIR / "server" / "gliner2_server.py"
VENV_DIR = REPO_DIR / ".venv"
VENV_PYTHON = VENV_DIR / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
REQUIREMENTS = REPO_DIR / "requirements.txt"

RUNTIME_DIR = REPO_DIR / ".runtime"
STATE_DIR = RUNTIME_DIR
STATE_FILE = STATE_DIR / "native_host_state.json"
LOG_FILE = STATE_DIR / "gliner2_server.log"
CACHE_DIR = RUNTIME_DIR / "cache"
PIP_CACHE_DIR = CACHE_DIR / "pip"
HF_HOME = CACHE_DIR / "hf"
HF_HUB_CACHE = HF_HOME / "hub"
TRANSFORMERS_CACHE = HF_HOME / "transformers"
XDG_CACHE_HOME = CACHE_DIR / "xdg"


def read_native_message() -> Dict[str, Any]:
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        return {}
    if len(raw_length) < 4:
        raise RuntimeError("Invalid native message length prefix.")
    message_length = struct.unpack("<I", raw_length)[0]
    payload = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(payload)


def runtime_meta() -> Dict[str, Any]:
    model_override = os.environ.get(MODEL_ENV_VAR, "").strip()
    return {
        "healthUrl": SERVER_URL,
        "healthCommand": f"curl {SERVER_URL}",
        "logFile": str(LOG_FILE),
        "logCommand": f"tail -n 80 {LOG_FILE}",
        "runtimeDir": str(RUNTIME_DIR),
        "modelOverride": model_override or None,
    }


def read_recent_logs(lines: int = 120) -> list[str]:
    ensure_runtime_dirs()
    try:
        all_lines = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return []
    keep = max(1, min(int(lines), 500))
    return all_lines[-keep:]


def send_native_message(message: Dict[str, Any]) -> None:
    encoded = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def ensure_runtime_dirs() -> None:
    for path in (
        RUNTIME_DIR,
        STATE_DIR,
        CACHE_DIR,
        PIP_CACHE_DIR,
        HF_HOME,
        HF_HUB_CACHE,
        TRANSFORMERS_CACHE,
        XDG_CACHE_HOME,
    ):
        path.mkdir(parents=True, exist_ok=True)
    LOG_FILE.touch(exist_ok=True)


def runtime_env(extra_env: Dict[str, str] | None = None) -> Dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "PIP_CACHE_DIR": str(PIP_CACHE_DIR),
            "PIP_DISABLE_PIP_VERSION_CHECK": "1",
            "HF_HOME": str(HF_HOME),
            "HUGGINGFACE_HUB_CACHE": str(HF_HUB_CACHE),
            "TRANSFORMERS_CACHE": str(TRANSFORMERS_CACHE),
            "XDG_CACHE_HOME": str(XDG_CACHE_HOME),
        }
    )
    if extra_env:
        env.update(extra_env)
    return env


def run_cmd(
    cmd: list[str],
    cwd: Path | None = None,
    env: Dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def trim_output(text: str, max_lines: int = 28) -> str:
    lines = [line for line in str(text or "").splitlines() if line.strip()]
    if not lines:
        return ""
    if len(lines) <= max_lines:
        return "\n".join(lines)
    return "\n".join(lines[-max_lines:])


def load_state() -> Dict[str, Any]:
    ensure_runtime_dirs()
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state: Dict[str, Any]) -> None:
    ensure_runtime_dirs()
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def is_pid_running(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def wait_for_health(timeout: float = WAIT_SECONDS) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_server_healthy():
            return True
        time.sleep(0.4)
    return False


def is_server_healthy() -> bool:
    try:
        with urllib.request.urlopen(SERVER_URL, timeout=1.5) as response:
            if response.status != 200:
                return False
            data = json.loads(response.read().decode("utf-8"))
            return bool(data.get("ok"))
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False


def ensure_venv() -> None:
    ensure_runtime_dirs()
    if VENV_PYTHON.exists():
        return
    result = run_cmd([sys.executable, "-m", "venv", str(VENV_DIR)], cwd=REPO_DIR, env=runtime_env())
    if result.returncode != 0:
        raise RuntimeError(f"Failed to create virtualenv: {result.stderr.strip()}")


def ensure_dependencies() -> None:
    ensure_venv()
    env = runtime_env()
    check_import = run_cmd(
        [str(VENV_PYTHON), "-c", "from gliner2_onnx import GLiNER2ONNXRuntime; print('ok')"],
        cwd=REPO_DIR,
        env=env,
    )
    if check_import.returncode == 0:
        return

    pip_upgrade = run_cmd([str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip"], cwd=REPO_DIR, env=env)
    if pip_upgrade.returncode != 0:
        raise RuntimeError(f"pip upgrade failed: {pip_upgrade.stderr.strip() or pip_upgrade.stdout.strip()}")

    install = run_cmd([str(VENV_PYTHON), "-m", "pip", "install", "-r", str(REQUIREMENTS)], cwd=REPO_DIR, env=env)
    if install.returncode != 0:
        raise RuntimeError(f"Dependency install failed: {install.stderr.strip() or install.stdout.strip()}")

    verify = run_cmd(
        [str(VENV_PYTHON), "-c", "from gliner2_onnx import GLiNER2ONNXRuntime; print('ok')"],
        cwd=REPO_DIR,
        env=env,
    )
    if verify.returncode != 0:
        details = trim_output(verify.stderr or verify.stdout)
        raise RuntimeError(f"Dependency verification failed:\n{details}")


def ensure_model_downloaded(model_id: str = "", extra_env: Dict[str, str] | None = None) -> None:
    cmd = [str(VENV_PYTHON), str(SCRIPT_PATH), "--download-only"]
    if str(model_id or "").strip():
        cmd.extend(["--model", str(model_id).strip()])
    download = run_cmd(
        cmd,
        cwd=REPO_DIR,
        env=runtime_env(extra_env),
    )
    if download.returncode != 0:
        details = trim_output(download.stderr or download.stdout)
        raise RuntimeError(
            "Model download failed. "
            "The default ONNX model is public, so no HF token is normally required. "
            "If you are using a private or gated model, set HF_TOKEN and retry, "
            "or set GLINER2_MODEL to a local model directory. "
            f"Details:\n{details}"
        )


def start_server(install_deps: bool, download_model: bool, hf_token: str = "", model_id: str = "") -> Dict[str, Any]:
    # Health-check first: if the server is already responding (e.g. started by another
    # browser's extension), reuse it immediately without touching the PID file.
    if is_server_healthy():
        state = load_state()
        return {
            "success": True,
            "running": True,
            "healthy": True,
            "pid": state.get("pid"),
            "message": "Server already running (detected by health check).",
            **runtime_meta(),
        }

    state = load_state()
    pid = state.get("pid")
    if is_pid_running(pid):
        healthy = is_server_healthy()
        return {
            "success": True,
            "running": True,
            "healthy": healthy,
            "pid": pid,
            "message": "Server already running.",
            **runtime_meta(),
        }

    hf_token_value = str(hf_token or "").strip()
    extra_env: Dict[str, str] = {}
    if hf_token_value:
        extra_env["HF_TOKEN"] = hf_token_value
        extra_env["HUGGING_FACE_HUB_TOKEN"] = hf_token_value

    # Model precedence: popup selection > GLINER2_MODEL env var > server default
    resolved_model = str(model_id or "").strip() or os.environ.get(MODEL_ENV_VAR, "").strip()
    if resolved_model:
        extra_env[MODEL_ENV_VAR] = resolved_model

    if install_deps:
        ensure_dependencies()

    if download_model:
        ensure_model_downloaded(resolved_model, extra_env)

    ensure_runtime_dirs()
    log_handle = LOG_FILE.open("a", encoding="utf-8")
    cmd = [str(VENV_PYTHON), "-u", str(SCRIPT_PATH), "--host", "127.0.0.1", "--port", "8765"]
    if resolved_model:
        cmd.extend(["--model", resolved_model])

    process = subprocess.Popen(
        cmd,
        cwd=str(REPO_DIR),
        env=runtime_env({**extra_env, "PYTHONUNBUFFERED": "1"}),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    log_handle.close()

    new_state = {
        "pid": process.pid,
        "started_at": int(time.time()),
        "log_file": str(LOG_FILE),
        "repo_dir": str(REPO_DIR),
        "runtime_dir": str(RUNTIME_DIR),
    }
    save_state(new_state)

    healthy = wait_for_health()
    return {
        "success": True,
        "running": True,
        "healthy": healthy,
        "pid": process.pid,
        "message": "Server started.",
        **runtime_meta(),
    }


def stop_server() -> Dict[str, Any]:
    state = load_state()
    pid = state.get("pid")

    if not is_pid_running(pid):
        return {
            "success": True,
            "running": False,
            "healthy": False,
            "message": "Server is not running.",
            **runtime_meta(),
        }

    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass

    deadline = time.time() + 5
    while time.time() < deadline:
        if not is_pid_running(pid):
            break
        time.sleep(0.2)

    if is_pid_running(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass

    save_state({})
    return {
        "success": True,
        "running": False,
        "healthy": False,
        "message": "Server stopped.",
        **runtime_meta(),
    }


def server_status() -> Dict[str, Any]:
    state = load_state()
    pid = state.get("pid")
    tracked_running = is_pid_running(pid)
    healthy = is_server_healthy()
    running = tracked_running or healthy
    if pid and not tracked_running and not healthy:
        save_state({})
    return {
        "success": True,
        "running": running,
        "healthy": healthy,
        "pid": pid if tracked_running else None,
        "host": HOST_NAME,
        "logExists": LOG_FILE.exists(),
        **runtime_meta(),
    }


def server_logs(lines: int = 120) -> Dict[str, Any]:
    return {
        "success": True,
        "logExists": LOG_FILE.exists(),
        "logLines": read_recent_logs(lines),
        **runtime_meta(),
    }


def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    action = request.get("action")
    if action == "status":
        return server_status()
    if action == "start":
        return start_server(
            install_deps=bool(request.get("installDeps", True)),
            download_model=bool(request.get("downloadModel", True)),
            hf_token=str(request.get("hfToken", "")),
            model_id=str(request.get("modelId", "")),
        )
    if action == "stop":
        return stop_server()
    if action == "logs":
        raw_lines = request.get("lines", 120)
        try:
            lines = int(raw_lines)
        except (TypeError, ValueError):
            lines = 120
        return server_logs(lines=lines)
    return {"success": False, "error": f"Unsupported action: {action}"}


def main() -> None:
    try:
        request = read_native_message()
        if not request:
            return
        response = handle_request(request)
    except Exception as exc:  # broad for native messaging stability
        response = {"success": False, "error": str(exc)}
    send_native_message(response)


if __name__ == "__main__":
    main()
