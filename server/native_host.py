#!/usr/bin/env python3
"""
Native messaging host for Veil.

The host exposes start / stop / restart / status controls for the local
GLiNER2 server. The backend runtime itself is managed by uv and kept inside the
Veil install directory.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

HOST_NAME = "com.privacyshield.gliner2"
SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8765
SERVER_URL = f"http://{SERVER_HOST}:{SERVER_PORT}/health"
WAIT_SECONDS = 18
MODEL_ENV_VAR = "GLINER2_MODEL"
PINNED_UV_VERSION = "0.10.7"
PINNED_PYTHON_VERSION = "3.11.11"

REPO_DIR = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_DIR / "server" / "gliner2_server.py"
VENV_DIR = REPO_DIR / ".venv"
VENV_PYTHON = VENV_DIR / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
PYPROJECT_FILE = REPO_DIR / "pyproject.toml"
UV_LOCK_FILE = REPO_DIR / "uv.lock"

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
UV_CACHE_DIR = CACHE_DIR / "uv"
UV_PYTHON_INSTALL_DIR = RUNTIME_DIR / "python"
UV_BIN_DIR = RUNTIME_DIR / "tools" / "uv"
UV_BINARY = UV_BIN_DIR / ("uv.exe" if os.name == "nt" else "uv")
RELEASE_INFO_FILE = RUNTIME_DIR / "bundle_release.json"
PROCESS_STATE_FILE = RUNTIME_DIR / "server_process.json"


def read_native_message() -> Dict[str, Any]:
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        return {}
    if len(raw_length) < 4:
        raise RuntimeError("Invalid native message length prefix.")
    message_length = struct.unpack("<I", raw_length)[0]
    payload = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(payload)


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
        UV_CACHE_DIR,
        UV_PYTHON_INSTALL_DIR,
        UV_BIN_DIR,
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
            "UV_CACHE_DIR": str(UV_CACHE_DIR),
            "UV_PYTHON_INSTALL_DIR": str(UV_PYTHON_INSTALL_DIR),
            "UV_PROJECT_ENVIRONMENT": str(VENV_DIR),
            "UV_LINK_MODE": "copy",
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


def read_process_state() -> Dict[str, Any]:
    ensure_runtime_dirs()
    if not PROCESS_STATE_FILE.exists():
        return {}
    try:
        return json.loads(PROCESS_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def clear_process_state() -> None:
    ensure_runtime_dirs()
    try:
        PROCESS_STATE_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def read_bundle_release_info() -> Dict[str, Any]:
    ensure_runtime_dirs()
    defaults = {
        "bundleReleaseTag": None,
        "bundleReleasePublishedAt": None,
        "bundleReleaseUrl": None,
        "bundleReleaseInstalledAt": None,
    }
    if not RELEASE_INFO_FILE.exists():
        return defaults
    try:
        payload = json.loads(RELEASE_INFO_FILE.read_text(encoding="utf-8"))
    except Exception:
        return defaults
    return {
        "bundleReleaseTag": str(payload.get("tag") or "").strip() or None,
        "bundleReleasePublishedAt": str(payload.get("published_at") or "").strip() or None,
        "bundleReleaseUrl": str(payload.get("html_url") or "").strip() or None,
        "bundleReleaseInstalledAt": str(payload.get("installed_at") or "").strip() or None,
    }


def read_recent_logs(lines: int = 120) -> list[str]:
    ensure_runtime_dirs()
    try:
        all_lines = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return []
    process_state = read_process_state()
    session_id = str(process_state.get("session_id") or "").strip()
    if session_id:
        marker = f"[server-session {session_id}]"
        for index in range(len(all_lines) - 1, -1, -1):
            if marker in all_lines[index]:
                all_lines = all_lines[index:]
                break
    keep = max(1, min(int(lines), 500))
    return all_lines[-keep:]


def is_pid_running(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def is_port_open(host: str = SERVER_HOST, port: int = SERVER_PORT) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
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


def wait_for_health(timeout: float = WAIT_SECONDS) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_server_healthy():
            return True
        time.sleep(0.4)
    return False


def normalize_command(command: str) -> str:
    normalized = str(command or "")
    if os.name == "nt":
        return normalized.replace("/", "\\").lower()
    return normalized


def is_owned_server_command(command: str) -> bool:
    normalized = normalize_command(command)
    script_path = normalize_command(str(SCRIPT_PATH))
    repo_dir = normalize_command(str(REPO_DIR))
    return script_path in normalized and repo_dir in normalized


def list_processes() -> list[dict[str, Any]]:
    if os.name == "nt":
        script = (
            "$ErrorActionPreference='SilentlyContinue';"
            "Get-CimInstance Win32_Process | "
            "Select-Object @{Name='pid';Expression={[int]$_.ProcessId}},"
            "@{Name='command';Expression={[string]$_.CommandLine}} | "
            "ConvertTo-Json -Compress"
        )
        result = run_cmd(["powershell", "-NoProfile", "-Command", script])
        if result.returncode != 0 or not result.stdout.strip():
            return []
        try:
            payload = json.loads(result.stdout)
        except Exception:
            return []
        if isinstance(payload, dict):
            payload = [payload]
        return [item for item in payload if isinstance(item, dict)]

    result = run_cmd(["ps", "-eo", "pid=,args="])
    if result.returncode != 0:
        return []

    processes: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if not parts:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        command = parts[1] if len(parts) > 1 else ""
        processes.append({"pid": pid, "command": command})
    return processes


def discover_owned_server_pids() -> list[int]:
    pids: list[int] = []
    seen: set[int] = set()
    for item in list_processes():
        pid = item.get("pid")
        command = item.get("command")
        if not isinstance(pid, int) or pid in seen:
            continue
        if pid == os.getpid():
            continue
        if is_owned_server_command(str(command or "")) and is_pid_running(pid):
            seen.add(pid)
            pids.append(pid)
    return pids


def tracked_server_pids() -> list[int]:
    candidates: list[int] = []
    seen: set[int] = set()
    for payload in (read_process_state(), load_state()):
        pid = payload.get("pid")
        if isinstance(pid, int) and pid not in seen and is_pid_running(pid):
            seen.add(pid)
            candidates.append(pid)
    for pid in discover_owned_server_pids():
        if pid not in seen:
            seen.add(pid)
            candidates.append(pid)
    return candidates


def remember_server_pid(pid: int | None) -> None:
    if not pid:
        return
    save_state(
        {
            "pid": int(pid),
            "started_at": int(time.time()),
            "log_file": str(LOG_FILE),
            "repo_dir": str(REPO_DIR),
            "runtime_dir": str(RUNTIME_DIR),
        }
    )


def active_server_pid() -> int | None:
    for pid in tracked_server_pids():
        remember_server_pid(pid)
        return pid
    return None


def kill_pid(pid: int) -> bool:
    if not is_pid_running(pid):
        return True
    try:
        if os.name == "nt":
            os.kill(pid, signal.SIGTERM)
        else:
            os.kill(pid, signal.SIGTERM)
    except OSError:
        pass

    deadline = time.time() + 5
    while time.time() < deadline:
        if not is_pid_running(pid):
            return True
        time.sleep(0.2)

    if os.name == "nt":
        result = run_cmd(["taskkill", "/PID", str(pid), "/F", "/T"])
        return result.returncode == 0 or not is_pid_running(pid)

    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    time.sleep(0.2)
    return not is_pid_running(pid)


def resolve_uv_binary() -> Path | None:
    ensure_runtime_dirs()
    if UV_BINARY.exists():
        return UV_BINARY
    return None


@lru_cache(maxsize=1)
def read_uv_version() -> str | None:
    uv_binary = resolve_uv_binary()
    if not uv_binary:
        return None
    result = run_cmd([str(uv_binary), "--version"], cwd=REPO_DIR, env=runtime_env())
    if result.returncode != 0:
        return None
    return str(result.stdout.strip() or result.stderr.strip() or "").strip() or None


@lru_cache(maxsize=1)
def read_runtime_python_version() -> str | None:
    if not VENV_PYTHON.exists():
        return None
    result = run_cmd(
        [str(VENV_PYTHON), "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"],
        cwd=REPO_DIR,
        env=runtime_env(),
    )
    if result.returncode != 0:
        return None
    return str(result.stdout.strip() or "").strip() or None


def runtime_meta() -> Dict[str, Any]:
    model_override = os.environ.get(MODEL_ENV_VAR, "").strip()
    owned_pid = active_server_pid()
    port_open = is_port_open()
    return {
        "installed": VENV_PYTHON.exists(),
        "healthUrl": SERVER_URL,
        "healthCommand": f"curl {SERVER_URL}",
        "logFile": str(LOG_FILE),
        "logCommand": f"tail -n 80 {LOG_FILE}",
        "runtimeDir": str(RUNTIME_DIR),
        "venvDir": str(VENV_DIR),
        "runtimePython": str(VENV_PYTHON),
        "runtimePythonVersion": read_runtime_python_version(),
        "uvBinary": str(resolve_uv_binary()) if resolve_uv_binary() else None,
        "uvVersion": read_uv_version(),
        "uvPinnedVersion": PINNED_UV_VERSION,
        "pythonPinnedVersion": PINNED_PYTHON_VERSION,
        "lockFile": str(UV_LOCK_FILE),
        "modelOverride": model_override or None,
        "restartSupported": True,
        "portConflict": bool(port_open and owned_pid is None and not is_server_healthy()),
        **read_bundle_release_info(),
    }


def sync_managed_runtime() -> None:
    uv_binary = resolve_uv_binary()
    if uv_binary is None:
        raise RuntimeError(
            "Veil runtime manager is missing. Re-run the installer to restore the pinned uv runtime."
        )
    if not PYPROJECT_FILE.exists() or not UV_LOCK_FILE.exists():
        raise RuntimeError(
            "Veil runtime metadata is missing. Re-run the installer to restore pyproject.toml and uv.lock."
        )

    env = runtime_env()
    python_install = run_cmd(
        [
            str(uv_binary),
            "python",
            "install",
            PINNED_PYTHON_VERSION,
            "--install-dir",
            str(UV_PYTHON_INSTALL_DIR),
        ],
        cwd=REPO_DIR,
        env=env,
    )
    if python_install.returncode != 0:
        details = trim_output(python_install.stderr or python_install.stdout)
        raise RuntimeError(f"Managed Python install failed:\n{details}")

    sync = run_cmd(
        [
            str(uv_binary),
            "sync",
            "--frozen",
            "--no-dev",
            "--no-install-project",
            "--directory",
            str(REPO_DIR),
            "--python",
            PINNED_PYTHON_VERSION,
            "--managed-python",
        ],
        cwd=REPO_DIR,
        env=env,
    )
    if sync.returncode != 0:
        details = trim_output(sync.stderr or sync.stdout)
        raise RuntimeError(f"Runtime sync failed:\n{details}")

    read_runtime_python_version.cache_clear()


def ensure_dependencies() -> None:
    ensure_runtime_dirs()
    if not VENV_PYTHON.exists():
        sync_managed_runtime()

    check_import = run_cmd(
        [str(VENV_PYTHON), "-c", "from gliner2_onnx import GLiNER2ONNXRuntime; print('ok')"],
        cwd=REPO_DIR,
        env=runtime_env(),
    )
    if check_import.returncode == 0:
        return

    sync_managed_runtime()

    verify = run_cmd(
        [str(VENV_PYTHON), "-c", "from gliner2_onnx import GLiNER2ONNXRuntime; print('ok')"],
        cwd=REPO_DIR,
        env=runtime_env(),
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


def server_status() -> Dict[str, Any]:
    process_state = read_process_state()
    process_pid = process_state.get("pid")
    process_running = is_pid_running(process_pid)

    state = load_state()
    tracked_pid = state.get("pid")
    tracked_running = is_pid_running(tracked_pid)

    owned_pids = discover_owned_server_pids()
    owned_pid = owned_pids[0] if owned_pids else None
    healthy = is_server_healthy()
    port_open = is_port_open()
    port_conflict = bool(port_open and owned_pid is None and not healthy)
    running = bool(process_running or tracked_running or owned_pid or healthy)

    if owned_pid and not tracked_running:
        remember_server_pid(owned_pid)

    if not running and not port_conflict:
        clear_process_state()
        save_state({})
    elif tracked_pid and not tracked_running and not healthy and not port_open:
        save_state({})

    return {
        "success": True,
        "running": running,
        "healthy": healthy,
        "pid": process_pid if process_running else (tracked_pid if tracked_running else owned_pid),
        "host": HOST_NAME,
        "logExists": LOG_FILE.exists(),
        "portConflict": port_conflict,
        **runtime_meta(),
    }


def server_logs(lines: int = 120) -> Dict[str, Any]:
    return {
        "success": True,
        "logExists": LOG_FILE.exists(),
        "logLines": read_recent_logs(lines),
        **runtime_meta(),
    }


def start_server(
    install_deps: bool,
    download_model: bool,
    hf_token: str = "",
    model_id: str = "",
) -> Dict[str, Any]:
    status = server_status()
    if status["healthy"]:
        return {
            "success": True,
            "running": True,
            "healthy": True,
            "pid": status.get("pid"),
            "message": "Server already running (detected by health check).",
            **runtime_meta(),
        }

    if status["running"]:
        return {
            "success": True,
            "running": True,
            "healthy": False,
            "pid": status.get("pid"),
            "message": "Server is already starting.",
            **runtime_meta(),
        }

    if status.get("portConflict"):
        return {
            "success": True,
            "running": False,
            "healthy": False,
            "pid": None,
            "portConflict": True,
            "message": "Port 8765 is already in use by another local process. Veil will not stop it automatically.",
            **runtime_meta(),
        }

    hf_token_value = str(hf_token or "").strip()
    extra_env: Dict[str, str] = {}
    if hf_token_value:
        extra_env["HF_TOKEN"] = hf_token_value
        extra_env["HUGGING_FACE_HUB_TOKEN"] = hf_token_value

    resolved_model = str(model_id or "").strip() or os.environ.get(MODEL_ENV_VAR, "").strip()
    if resolved_model:
        extra_env[MODEL_ENV_VAR] = resolved_model

    if install_deps:
        ensure_dependencies()

    if download_model:
        ensure_model_downloaded(resolved_model, extra_env)

    ensure_runtime_dirs()
    if not VENV_PYTHON.exists():
        raise RuntimeError("Veil managed runtime is missing. Re-run the installer to restore the local environment.")
    log_handle = LOG_FILE.open("a", encoding="utf-8")
    cmd = [str(VENV_PYTHON), "-u", str(SCRIPT_PATH), "--host", SERVER_HOST, "--port", str(SERVER_PORT)]
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

    remember_server_pid(process.pid)

    healthy = wait_for_health()
    return {
        "success": True,
        "running": True,
        "healthy": healthy,
        "pid": process.pid,
        "message": "Server started." if healthy else "Server is starting.",
        **runtime_meta(),
    }


def stop_server() -> Dict[str, Any]:
    pids = tracked_server_pids()

    if not pids:
        clear_process_state()
        save_state({})
        return {
            "success": True,
            "running": False,
            "healthy": False,
            "message": "Server is not running.",
            **runtime_meta(),
        }

    failures = [pid for pid in pids if not kill_pid(pid)]
    if failures:
        return {
            "success": False,
            "error": f"Failed to stop Veil-managed server process(es): {', '.join(map(str, failures))}.",
            "running": True,
            "healthy": is_server_healthy(),
            "pid": failures[0],
            **runtime_meta(),
        }

    clear_process_state()
    save_state({})
    return {
        "success": True,
        "running": False,
        "healthy": False,
        "message": "Server stopped.",
        **runtime_meta(),
    }


def restart_server(
    install_deps: bool,
    download_model: bool,
    hf_token: str = "",
    model_id: str = "",
) -> Dict[str, Any]:
    stop_result = stop_server()
    if not stop_result.get("success"):
        return stop_result
    return start_server(
        install_deps=install_deps,
        download_model=download_model,
        hf_token=hf_token,
        model_id=model_id,
    )


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
    if action == "restart":
        return restart_server(
            install_deps=bool(request.get("installDeps", True)),
            download_model=bool(request.get("downloadModel", True)),
            hf_token=str(request.get("hfToken", "")),
            model_id=str(request.get("modelId", "")),
        )
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
