#!/usr/bin/env python3
"""
Intent: native desktop shell for Retro Music Player (local window over Express).
Architecture: owned Node server subprocess + pywebview (Cocoa); private_mode=False
and a fixed preferred port so origin-scoped localStorage stays stable; UI prefs also
mirror to ~/Library/Application Support/Retro Music Player/prefs.json via /api/prefs.
Also owns Divoom MiniToo RFCOMM daemon + HTTP bridge children when available.
Music dumps under Application Support (or repo data/ when developing); launch errors
in Logs.
Quality: 8/10 — MyChat / Chess Insight pattern adapted for Node + Vite dist.
"""

from __future__ import annotations

import atexit
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import IO

ROOT = Path(__file__).resolve().parent
LOG_DIR = Path.home() / "Library" / "Logs"
LOG_FILE = LOG_DIR / "Retro Music Player.log"
SUPPORT_DIR = Path.home() / "Library" / "Application Support" / "Retro Music Player"
WEBVIEW_DIR = SUPPORT_DIR / "webview"
PREFERRED_PORT = int(os.environ.get("PORT", os.environ.get("RETRO_MUSIC_PORT", "3010")))
MINITOO_DAEMON_PORT = int(os.environ.get("MINITOO_DAEMON_PORT", "40583"))
MINITOO_BRIDGE_PORT = int(os.environ.get("MINITOO_BRIDGE_PORT", "8766"))

_server_proc: subprocess.Popen[str] | None = None
_daemon_proc: subprocess.Popen[str] | None = None
_bridge_proc: subprocess.Popen[str] | None = None
_owned_daemon = False
_owned_bridge = False


def _log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n"
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError:
        pass
    print(msg, flush=True)


def _alert(title: str, message: str) -> None:
    if sys.platform != "darwin":
        return
    try:

        def esc(s: str) -> str:
            return s.replace("\\", "\\\\").replace('"', '\\"')

        subprocess.run(
            [
                "osascript",
                "-e",
                f'display alert "{esc(title)}" message "{esc(message)}" as critical',
            ],
            check=False,
            capture_output=True,
        )
    except Exception:
        pass


def _port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex((host, port)) == 0


def _is_our_server(host: str, port: int) -> bool:
    try:
        import urllib.request

        with urllib.request.urlopen(f"http://{host}:{port}/api/health", timeout=0.8) as resp:
            if resp.getcode() != 200:
                return False
            body = resp.read(512).decode("utf-8", errors="ignore")
            return "retro-music-player" in body and '"ok"' in body
    except Exception:
        return False


def _wait_ready(host: str, port: int, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _is_our_server(host, port):
            return True
        if _server_proc is not None and _server_proc.poll() is not None:
            return False
        time.sleep(0.15)
    return False


def _pids_listening_on_port(port: int) -> list[int]:
    """Return PIDs listening on TCP port (macOS/Linux via lsof)."""
    if not shutil.which("lsof"):
        return []
    try:
        out = subprocess.check_output(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, OSError):
        return []
    pids: list[int] = []
    for line in out.splitlines():
        line = line.strip()
        if line.isdigit():
            pids.append(int(line))
    return pids


def _wait_port_closed(host: str, port: int, timeout: float = 8.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not _port_open(host, port):
            return True
        time.sleep(0.1)
    return not _port_open(host, port)


def _reclaim_preferred_port(host: str, preferred: int) -> None:
    """
    Keep a stable origin (http://127.0.0.1:PREFERRED). localStorage is origin-scoped,
    so hopping to 3011+ after a rebuild looks like wiped settings.
    """
    if not _port_open(host, preferred):
        return

    ours = _is_our_server(host, preferred)
    pids = _pids_listening_on_port(preferred)
    if ours or pids:
        _log(
            f"[retro-music] Reclaiming port {preferred}"
            f"{' (leftover Retro Music Player)' if ours else ''}"
            f" — stopping PID(s) {pids or '?'}"
        )
        for pid in pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
        if not _wait_port_closed(host, preferred, timeout=4.0):
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass
            _wait_port_closed(host, preferred, timeout=3.0)

    if _port_open(host, preferred):
        raise RuntimeError(
            f"Port {preferred} is still busy (needed for stable settings storage).\n"
            f"Quit whatever is using it, or set RETRO_MUSIC_PORT to a free port "
            f"and keep using that same port every launch."
        )


def _pick_free_port(host: str, preferred: int) -> int:
    _reclaim_preferred_port(host, preferred)
    return preferred


def _has_archives(data_dir: Path) -> bool:
    markers = [
        data_dir / "sndh" / "sndh_lf",
        data_dir / "amiga" / "unexotica",
        data_dir / "cpc",
        data_dir / "c64" / "HVSC" / "C64Music",
        data_dir / "vgm" / "vgmrips",
    ]
    return any(p.exists() for p in markers)


def _resolve_data_dir() -> Path:
    override = os.environ.get("RETRO_MUSIC_DATA_DIR", "").strip()
    if override:
        path = Path(override).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    repo_data = ROOT / "data"
    if _has_archives(repo_data):
        return repo_data

    support_data = SUPPORT_DIR / "data"
    support_data.mkdir(parents=True, exist_ok=True)
    readme = support_data / "README.txt"
    if not readme.is_file():
        readme.write_text(
            "Put music archives here (or symlink your existing dumps):\n"
            "  sndh/sndh_lf/\n"
            "  amiga/unexotica/\n"
            "  cpc/cpc_lf/ and cpc/ym_games/\n"
            "  c64/HVSC/C64Music/\n"
            "\n"
            "Example:\n"
            "  ln -s /path/to/retro-music-player/data/sndh "
            f'"{support_data / "sndh"}"\n',
            encoding="utf-8",
        )
    return support_data


def _find_node() -> str:
    node = shutil.which("node")
    if not node:
        raise RuntimeError(
            "Node.js was not found on PATH.\n"
            "Install from https://nodejs.org/ or: brew install node"
        )
    return node


def _find_tsx(app_root: Path) -> list[str]:
    local = app_root / "node_modules" / "tsx" / "dist" / "cli.mjs"
    if local.is_file():
        return [str(local)]
    tsx_bin = app_root / "node_modules" / ".bin" / "tsx"
    if tsx_bin.is_file():
        return [str(tsx_bin)]
    which = shutil.which("tsx")
    if which:
        return [which]
    raise RuntimeError(
        "tsx is missing. From the app folder run:\n  npm install\n"
        "Or rebuild with scripts/build_macos_app.sh"
    )


def _stop_proc(label: str, proc: subprocess.Popen[str] | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    _log(f"[retro-music] Stopping {label}…")
    try:
        proc.send_signal(signal.SIGTERM)
    except OSError:
        pass
    try:
        proc.wait(timeout=4.0)
    except subprocess.TimeoutExpired:
        _log(f"[retro-music] Force-killing {label}")
        try:
            proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            pass


def _stop_server() -> None:
    global _server_proc
    proc = _server_proc
    _server_proc = None
    _stop_proc("Node server", proc)


def _stop_minitoo() -> None:
    global _daemon_proc, _bridge_proc, _owned_daemon, _owned_bridge
    if _owned_bridge:
        _stop_proc("MiniToo bridge", _bridge_proc)
    if _owned_daemon:
        _stop_proc("MiniToo daemon", _daemon_proc)
    _bridge_proc = None
    _daemon_proc = None
    _owned_bridge = False
    _owned_daemon = False


def _resolve_minitoo_dir() -> Path | None:
    """Bundled Resources/minitoo, or sibling Minitoo checkout (dev)."""
    bundled = ROOT.parent / "minitoo"
    if (bundled / "bin" / "divoom-daemon").is_file():
        return bundled
    env = os.environ.get("MINITOO_ROOT", "").strip()
    candidates: list[Path] = []
    if env:
        candidates.append(Path(env).expanduser().resolve())
    candidates.append((ROOT.parent / "Minitoo").resolve())
    for candidate in candidates:
        if not candidate.is_dir():
            continue
        if (
            (candidate / "minitoo").is_dir()
            or (candidate / "tools" / "divoom-daemon").is_file()
            or (candidate / "interfaces" / "rfcomm" / "divoom-daemon").is_file()
            or (candidate / "interfaces" / "rfcomm" / "DivoomDaemon.swift").is_file()
        ):
            return candidate
    return None


def _minitoo_daemon_bin(minitoo_dir: Path) -> Path | None:
    for candidate in (
        minitoo_dir / "bin" / "divoom-daemon",
        minitoo_dir / "tools" / "divoom-daemon",
        minitoo_dir / "interfaces" / "rfcomm" / "divoom-daemon",
    ):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def _read_minitoo_mac(minitoo_dir: Path) -> str | None:
    env_mac = os.environ.get("MINITOO_DEVICE_MAC", "").strip()
    if env_mac:
        return env_mac
    for path in (SUPPORT_DIR / "DEVICE_MAC.txt", minitoo_dir / "DEVICE_MAC.txt"):
        try:
            mac = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if mac:
            return mac
    return None


def _is_minitoo_bridge(host: str, port: int) -> bool:
    try:
        import urllib.request

        with urllib.request.urlopen(f"http://{host}:{port}/v1/health", timeout=0.8) as resp:
            if resp.getcode() != 200:
                return False
            body = resp.read(800).decode("utf-8", errors="ignore")
            return '"daemon"' in body and '"ok"' in body
    except Exception:
        return False


def _wait_minitoo_bridge(host: str, port: int, timeout: float = 8.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _is_minitoo_bridge(host, port):
            return True
        if _bridge_proc is not None and _bridge_proc.poll() is not None:
            return False
        time.sleep(0.15)
    return False


def _minitoo_importable() -> bool:
    try:
        import minitoo  # noqa: F401

        return True
    except ImportError:
        return False


def _maybe_disconnect_audio(mac: str) -> None:
    blueutil = shutil.which("blueutil")
    if not blueutil:
        return
    try:
        subprocess.run(
            [blueutil, "--disconnect", mac],
            check=False,
            capture_output=True,
            timeout=8,
        )
        time.sleep(0.8)
    except Exception as exc:
        _log(f"[retro-music] blueutil disconnect skipped: {exc}")


def _start_minitoo() -> None:
    """Soft-start RFCOMM daemon + HTTP bridge. Never blocks app launch."""
    global _daemon_proc, _bridge_proc, _owned_daemon, _owned_bridge

    host = "127.0.0.1"
    minitoo_dir = _resolve_minitoo_dir()
    if minitoo_dir is None:
        _log("[retro-music] MiniToo: no bundled/sibling stack — skip")
        return

    if not _minitoo_importable():
        _log(
            "[retro-music] MiniToo: Python package missing in this venv "
            "(pip install sibling Minitoo[bridge]) — skip"
        )
        return

    daemon_bin = _minitoo_daemon_bin(minitoo_dir)
    mac = _read_minitoo_mac(minitoo_dir)

    # Seed Application Support MAC from bundle so users can override later.
    support_mac = SUPPORT_DIR / "DEVICE_MAC.txt"
    if mac and not support_mac.is_file():
        try:
            SUPPORT_DIR.mkdir(parents=True, exist_ok=True)
            support_mac.write_text(mac + "\n", encoding="utf-8")
        except OSError:
            pass

    if not _port_open(host, MINITOO_DAEMON_PORT):
        if daemon_bin is None or not mac:
            _log(
                "[retro-music] MiniToo: daemon not running and no binary/MAC "
                f"(dir={minitoo_dir}) — skip"
            )
            return
        _maybe_disconnect_audio(mac)
        try:
            log_fh: IO[str] = LOG_FILE.open("a", encoding="utf-8")
            cmd = [str(daemon_bin), mac, "1", str(MINITOO_DAEMON_PORT)]
            _log(f"[retro-music] Starting MiniToo daemon: {' '.join(cmd)}")
            _daemon_proc = subprocess.Popen(
                cmd,
                cwd=str(minitoo_dir),
                stdout=log_fh,
                stderr=subprocess.STDOUT,
                text=True,
            )
            _owned_daemon = True
            time.sleep(1.0)
            if _daemon_proc.poll() is not None:
                _log("[retro-music] MiniToo daemon exited immediately — skip bridge")
                _owned_daemon = False
                _daemon_proc = None
                return
        except OSError as exc:
            _log(f"[retro-music] MiniToo daemon failed to start: {exc}")
            return
    else:
        _log(f"[retro-music] MiniToo: reusing daemon on :{MINITOO_DAEMON_PORT}")

    if _is_minitoo_bridge(host, MINITOO_BRIDGE_PORT):
        _log(f"[retro-music] MiniToo: reusing bridge on :{MINITOO_BRIDGE_PORT}")
        return

    if _port_open(host, MINITOO_BRIDGE_PORT):
        pids = _pids_listening_on_port(MINITOO_BRIDGE_PORT)
        _log(
            f"[retro-music] MiniToo: reclaiming bridge port {MINITOO_BRIDGE_PORT} "
            f"(PIDs {pids or '?'})"
        )
        for pid in pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
        _wait_port_closed(host, MINITOO_BRIDGE_PORT, timeout=3.0)

    env = os.environ.copy()
    env["MINITOO_DAEMON_HOST"] = host
    env["MINITOO_DAEMON_PORT"] = str(MINITOO_DAEMON_PORT)
    env["MINITOO_BRIDGE_HOST"] = host
    env["MINITOO_BRIDGE_PORT"] = str(MINITOO_BRIDGE_PORT)
    try:
        log_fh = LOG_FILE.open("a", encoding="utf-8")
        cmd = [
            sys.executable,
            "-m",
            "minitoo.bridge",
            "--host",
            host,
            "--port",
            str(MINITOO_BRIDGE_PORT),
        ]
        _log(f"[retro-music] Starting MiniToo bridge: {' '.join(cmd)}")
        _bridge_proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            env=env,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            text=True,
        )
        _owned_bridge = True
    except OSError as exc:
        _log(f"[retro-music] MiniToo bridge failed to start: {exc}")
        return

    if _wait_minitoo_bridge(host, MINITOO_BRIDGE_PORT):
        _log(f"[retro-music] MiniToo bridge ready http://{host}:{MINITOO_BRIDGE_PORT}")
    else:
        _log("[retro-music] MiniToo bridge did not become healthy (continuing without it)")


def _start_server(app_root: Path, host: str, port: int, data_dir: Path) -> None:
    global _server_proc
    node = _find_node()
    tsx_args = _find_tsx(app_root)
    server_entry = app_root / "server" / "index.ts"
    if not server_entry.is_file():
        raise RuntimeError(f"Missing server entry: {server_entry}")

    env = os.environ.copy()
    env["PORT"] = str(port)
    env["RETRO_MUSIC_DESKTOP"] = "1"
    env["RETRO_MUSIC_ROOT"] = str(app_root)
    env["RETRO_MUSIC_DATA_DIR"] = str(data_dir)
    env["NODE_ENV"] = env.get("NODE_ENV") or "production"

    cmd = [node, *tsx_args, str(server_entry)]
    _log(f"[retro-music] Starting: {' '.join(cmd)}")
    log_fh: IO[str] = LOG_FILE.open("a", encoding="utf-8")
    _server_proc = subprocess.Popen(
        cmd,
        cwd=str(app_root),
        env=env,
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        text=True,
    )
    atexit.register(_stop_minitoo)
    atexit.register(_stop_server)


def main() -> int:
    os.chdir(ROOT)
    os.environ.setdefault("PYWEBVIEW_GUI", "cocoa")
    SUPPORT_DIR.mkdir(parents=True, exist_ok=True)
    WEBVIEW_DIR.mkdir(parents=True, exist_ok=True)

    try:
        if sys.platform == "darwin":
            from AppKit import NSApplication

            NSApplication.sharedApplication()
        import webview
    except ImportError as exc:
        msg = (
            f"Missing dependency: {exc}\n"
            f"Install with:\n  npm run desktop:venv"
        )
        _log(msg)
        _alert("Retro Music Player failed to start", msg)
        return 1

    host = "127.0.0.1"
    dist_index = ROOT / "dist" / "index.html"
    if not dist_index.is_file():
        msg = (
            "Missing production build (dist/index.html).\n"
            "Run: npm run build\nThen: npm run desktop"
        )
        _log(msg)
        _alert("Retro Music Player failed to start", msg)
        return 1

    try:
        port = _pick_free_port(host, PREFERRED_PORT)
        data_dir = _resolve_data_dir()
        _log(f"[retro-music] Data dir: {data_dir}")
        _start_server(ROOT, host, port, data_dir)
    except Exception as exc:
        _log(str(exc))
        _alert("Retro Music Player failed to start", str(exc))
        return 1

    if not _wait_ready(host, port):
        tail = ""
        try:
            tail = LOG_FILE.read_text(encoding="utf-8")[-600:]
        except OSError:
            pass
        msg = f"Server failed to start on http://{host}:{port}\n\n{tail}"
        _log(msg)
        _stop_server()
        _alert("Retro Music Player failed to start", msg[:900])
        return 1

    _log(f"[retro-music] Serving http://{host}:{port}")
    try:
        _start_minitoo()
    except Exception as exc:
        _log(f"[retro-music] MiniToo start error (non-fatal): {exc}")
    url = f"http://{host}:{port}/"

    class DesktopApi:
        def __init__(self, base_url: str) -> None:
            self._base = base_url.rstrip("/")

        def download_file(self, url_path: str, filename: str) -> dict:
            if sys.platform != "darwin":
                return {"ok": False, "error": "Save dialog is only available on macOS"}

            result: dict = {"ok": False, "error": "Save dialog timed out"}
            done = threading.Event()

            def on_main() -> None:
                nonlocal result
                try:
                    result = self._download_file_on_main(url_path, filename)
                except Exception as exc:
                    result = {"ok": False, "error": str(exc)}
                finally:
                    done.set()

            from Foundation import NSOperationQueue

            NSOperationQueue.mainQueue().addOperationWithBlock_(on_main)
            if not done.wait(timeout=300):
                return {"ok": False, "error": "Save dialog timed out"}
            return result

        def _download_file_on_main(self, url_path: str, filename: str) -> dict:
            from AppKit import NSSavePanel
            import urllib.request

            safe_name = (filename or "track.bin").strip() or "track.bin"
            panel = NSSavePanel.savePanel()
            panel.setCanCreateDirectories_(True)
            panel.setNameFieldStringValue_(safe_name)
            panel.setTitle_("Save track")
            panel.setPrompt_("Save")

            if panel.runModal() != 1:
                return {"ok": False, "cancelled": True}

            dest_url = panel.URL()
            if dest_url is None:
                return {"ok": False, "cancelled": True}
            dest_path = dest_url.path()
            if not dest_path:
                return {"ok": False, "cancelled": True}

            path = url_path if url_path.startswith("/") else f"/{url_path}"
            full_url = f"{self._base}{path}"
            try:
                urllib.request.urlretrieve(full_url, dest_path)
            except Exception as exc:
                return {"ok": False, "error": str(exc)}
            return {"ok": True}

    webview.create_window(
        title="Retro Music Player",
        url=url,
        width=1440,
        height=920,
        min_size=(960, 680),
        background_color="#121018",
        js_api=DesktopApi(url),
    )
    try:
        webview.start(private_mode=False, storage_path=str(WEBVIEW_DIR))
    finally:
        _stop_minitoo()
        _stop_server()
        _log("[retro-music] Quit")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        tb = traceback.format_exc()
        _log(tb)
        _alert("Retro Music Player crashed", f"See log:\n{LOG_FILE}\n\n{tb[-800:]}")
        raise SystemExit(1)
