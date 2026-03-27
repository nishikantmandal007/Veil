"""
Regression tests for server/native_host.py utility behavior.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "server"))

import native_host


@pytest.fixture()
def runtime_paths(monkeypatch, tmp_path):
    runtime_dir = tmp_path / "runtime"
    cache_dir = runtime_dir / "cache"
    monkeypatch.setattr(native_host, "RUNTIME_DIR", runtime_dir)
    monkeypatch.setattr(native_host, "STATE_DIR", runtime_dir)
    monkeypatch.setattr(native_host, "STATE_FILE", runtime_dir / "native_host_state.json")
    monkeypatch.setattr(native_host, "LOG_FILE", runtime_dir / "gliner2_server.log")
    monkeypatch.setattr(native_host, "CACHE_DIR", cache_dir)
    monkeypatch.setattr(native_host, "PIP_CACHE_DIR", cache_dir / "pip")
    monkeypatch.setattr(native_host, "HF_HOME", cache_dir / "hf")
    monkeypatch.setattr(native_host, "HF_HUB_CACHE", cache_dir / "hf" / "hub")
    monkeypatch.setattr(native_host, "TRANSFORMERS_CACHE", cache_dir / "hf" / "transformers")
    monkeypatch.setattr(native_host, "XDG_CACHE_HOME", cache_dir / "xdg")
    monkeypatch.setattr(native_host, "UV_CACHE_DIR", cache_dir / "uv")
    monkeypatch.setattr(native_host, "UV_PYTHON_INSTALL_DIR", runtime_dir / "python")
    monkeypatch.setattr(native_host, "UV_BIN_DIR", runtime_dir / "tools" / "uv")
    monkeypatch.setattr(native_host, "UV_BINARY", runtime_dir / "tools" / "uv" / ("uv.exe" if native_host.os.name == "nt" else "uv"))
    monkeypatch.setattr(native_host, "RELEASE_INFO_FILE", runtime_dir / "bundle_release.json")
    monkeypatch.setattr(native_host, "PROCESS_STATE_FILE", runtime_dir / "server_process.json")
    monkeypatch.setattr(native_host, "PYPROJECT_FILE", tmp_path / "pyproject.toml")
    monkeypatch.setattr(native_host, "UV_LOCK_FILE", tmp_path / "uv.lock")
    return runtime_dir


def test_load_state_reads_existing_json(runtime_paths):
    native_host.ensure_runtime_dirs()
    native_host.STATE_FILE.write_text('{"pid": 1234}', encoding="utf-8")

    assert native_host.load_state() == {"pid": 1234}


def test_read_process_state_reads_existing_json(runtime_paths):
    native_host.ensure_runtime_dirs()
    native_host.PROCESS_STATE_FILE.write_text('{"pid": 5678, "session_id": "abc"}', encoding="utf-8")

    assert native_host.read_process_state() == {"pid": 5678, "session_id": "abc"}


def test_start_server_reports_port_conflict_for_non_veil_process(monkeypatch, runtime_paths):
    monkeypatch.setattr(native_host, "is_server_healthy", lambda: False)
    monkeypatch.setattr(native_host, "is_port_open", lambda host="127.0.0.1", port=8765: True)
    monkeypatch.setattr(native_host, "discover_owned_server_pids", lambda: [])
    monkeypatch.setattr(native_host, "load_state", lambda: {})
    monkeypatch.setattr(native_host, "read_process_state", lambda: {})
    monkeypatch.setattr(native_host, "runtime_meta", lambda: {})

    def fail_popen(*args, **kwargs):
        raise AssertionError("start_server should not spawn a new process when port 8765 is already bound")

    monkeypatch.setattr(native_host.subprocess, "Popen", fail_popen)

    result = native_host.start_server(install_deps=False, download_model=False)

    assert result["success"] is True
    assert result["running"] is False
    assert result["healthy"] is False
    assert result["portConflict"] is True
    assert "already in use by another local process" in result["message"]


def test_stop_server_only_targets_tracked_veil_processes(monkeypatch, runtime_paths):
    stopped = []
    monkeypatch.setattr(native_host, "tracked_server_pids", lambda: [4242])
    monkeypatch.setattr(native_host, "kill_pid", lambda pid: stopped.append(pid) or True)
    monkeypatch.setattr(native_host, "runtime_meta", lambda: {})

    result = native_host.stop_server()

    assert result["success"] is True
    assert result["running"] is False
    assert stopped == [4242]


def test_restart_server_stops_then_starts(monkeypatch, runtime_paths):
    events = []
    monkeypatch.setattr(native_host, "stop_server", lambda: events.append("stop") or {"success": True})
    monkeypatch.setattr(
        native_host,
        "start_server",
        lambda install_deps, download_model, hf_token="", model_id="": events.append(
            ("start", install_deps, download_model, hf_token, model_id)
        ) or {"success": True, "running": True},
    )

    result = native_host.restart_server(
        install_deps=True,
        download_model=False,
        hf_token="hf_token",
        model_id="fastino/gliner2-large-v1",
    )

    assert result["success"] is True
    assert events == [
        "stop",
        ("start", True, False, "hf_token", "fastino/gliner2-large-v1"),
    ]
