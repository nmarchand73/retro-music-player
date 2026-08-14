#!/usr/bin/env python3
"""Download the UnExoticA Amiga game-music collection (personal local mirror)."""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "data" / "amiga" / "unexotica"
PROGRESS = DEST / ".fetch-progress.json"
WIKI_ALL = "https://www.exotica.org.uk/mediawiki/index.php?title=UnExoticA/Games_By_Title/ALL&action=raw"
WIKI_RAW = "https://www.exotica.org.uk/mediawiki/index.php"
FILE_BASE = "https://files.exotica.org.uk/"
LISTING_HOSTS = (
    "https://malus.exotica.org.uk/pub/exotica/media/audio/UnExoticA/",
    "http://malus.exotica.org.uk/pub/exotica/media/audio/UnExoticA/",
)
USER_AGENT = "RetroMusicPlayer/1.0 (personal UnExoticA mirror)"
DELAY_S = 0.2

TITLE_RE = re.compile(r"^\|\[\[([^\]]+)\]\]", re.MULTILINE)
FILE_RE = re.compile(r"\|file=(.*\.lha)\|")
BOXSCAN_RE = re.compile(r"\|boxscan=(.*\.(?:jpg|png))", re.I)
DIR_HREF = re.compile(r'href=["\']([^"\'?#]+)/["\']', re.I)
LHA_HREF = re.compile(r'href=["\']([^"\'?#]+\.lha)["\']', re.I)


def session() -> requests.Session:
    sess = requests.Session()
    sess.headers.update({"User-Agent": USER_AGENT})
    return sess


def fetch_text(sess: requests.Session, url: str, tries: int = 8) -> str | None:
    last_error: Exception | None = None
    for attempt in range(1, tries + 1):
        if attempt > 1:
            wait = min(60, 5 * attempt)
            print(f"retry {attempt}/{tries} {url} after {wait}s", flush=True)
            time.sleep(wait)
        try:
            response = sess.get(url, timeout=30)
            if response.ok and response.text:
                return response.text
            last_error = ValueError(f"HTTP {response.status_code}")
            print(f"GET {url} -> {response.status_code}", flush=True)
        except requests.RequestException as error:
            last_error = error
            print(f"GET fail {url}: {error}", flush=True)
    if last_error:
        print(f"give up {url}: {last_error}", flush=True)
    return None


def listing_dirs(html: str) -> list[str]:
    skip = {".", "..", "parent directory"}
    names: list[str] = []
    seen: set[str] = set()
    for href in DIR_HREF.findall(html):
        name = href.rstrip("/").split("/")[-1]
        if not name or name.lower() in skip or name.startswith("?"):
            continue
        if name in seen:
            continue
        seen.add(name)
        names.append(name)
    return names


def listing_lhas(html: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for href in LHA_HREF.findall(html):
        name = Path(href).name
        if name in seen:
            continue
        seen.add(name)
        names.append(name)
    return names


def crawl_game_archives(sess: requests.Session, skip_cdda: bool) -> list[tuple[str, Path]]:
    html = None
    root = None
    for host in LISTING_HOSTS:
        html = fetch_text(sess, host + "Game/")
        if html and ("href" in html.lower()):
            root = host
            break
    if not html or not root:
        return []

    composers = listing_dirs(html)
    print(f"crawl {len(composers)} composers from {root}Game/", flush=True)
    jobs: list[tuple[str, Path]] = []
    for index, composer in enumerate(composers, start=1):
        time.sleep(DELAY_S)
        page = fetch_text(sess, f"{root}Game/{composer}/", tries=4)
        if not page:
            print(f"[{index}/{len(composers)}] no listing {composer}", flush=True)
            continue
        for name in listing_lhas(page):
            if skip_cdda and "_CDDA" in name:
                continue
            rel = f"media/audio/UnExoticA/Game/{composer}/{name}"
            dest = DEST / "Game" / composer / name
            jobs.append((rel, dest))
        if index % 25 == 0 or index == len(composers):
            print(f"listed {index}/{len(composers)} composers jobs={len(jobs)}", flush=True)
    return jobs


def wiki_title(raw: str) -> str:
    if "|" in raw:
        return raw.split("|", 1)[0].strip()
    return raw.strip()


def list_titles(sess: requests.Session) -> list[str]:
    last_error: Exception | None = None
    for attempt in range(1, 61):
        if attempt > 1:
            wait = min(90, 8 * attempt)
            print(f"wiki list retry {attempt}/60 after {wait}s", flush=True)
            time.sleep(wait)
        try:
            text = sess.get(WIKI_ALL, timeout=45).text
            titles = [wiki_title(match.group(1)) for match in TITLE_RE.finditer(text)]
            if titles:
                return titles
            last_error = ValueError("empty UnExoticA title list")
        except requests.RequestException as error:
            last_error = error
            print(f"wiki list error: {error}", flush=True)
    if last_error:
        raise last_error
    return []


def archive_link(sess: requests.Session, title: str) -> str | None:
    params = {"title": title.replace(" ", "_"), "action": "raw"}
    response = sess.get(WIKI_RAW, params=params, timeout=45)
    if not response.ok:
        return None
    match = FILE_RE.search(response.text)
    return match.group(1) if match else None


def download_cover(sess: requests.Session, wiki_raw: str, archive: Path) -> bool:
    stem = archive.stem
    extract_dir = archive.parent / stem
    if (extract_dir / "cover.jpg").exists() or (extract_dir / "cover.png").exists():
        return False
    if (archive.parent / f"{stem}.jpg").exists() or (archive.parent / f"{stem}.png").exists():
        return False
    match = BOXSCAN_RE.search(wiki_raw)
    if not match:
        return False
    filename = match.group(1).strip()
    if not filename or filename.lower() == "blankboxscan.png":
        return False
    url = "https://www.exotica.org.uk/wiki/Special:Redirect/file/" + urllib.parse.quote(filename)
    response = sess.get(url, timeout=45)
    response.raise_for_status()
    data = response.content
    if data[:3] == b"\xff\xd8\xff":
        ext = ".jpg"
    elif data[:4] == b"\x89PNG":
        ext = ".png"
    else:
        return False
    extract_dir.mkdir(parents=True, exist_ok=True)
    (extract_dir / f"cover{ext}").write_bytes(data)
    (archive.parent / f"{stem}{ext}").write_bytes(data)
    return True


def is_lha(data: bytes) -> bool:
    return len(data) > 8 and b"-lh" in data[:16]


def load_progress() -> dict[str, str]:
    if not PROGRESS.exists():
        return {}
    try:
        data = json.loads(PROGRESS.read_text())
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def save_progress(progress: dict[str, str]) -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    tmp = PROGRESS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(progress, indent=0, sort_keys=True))
    tmp.replace(PROGRESS)


def lha_urls(filelink: str) -> list[str]:
    suffix = filelink.split("UnExoticA/", 1)[-1]
    return [
        f"https://malus.exotica.org.uk/pub/exotica/media/audio/UnExoticA/{suffix}",
        f"http://malus.exotica.org.uk/pub/exotica/media/audio/UnExoticA/{suffix}",
        FILE_BASE + "?" + urllib.parse.urlencode({"file": "exotica/" + filelink}),
    ]


def download_lha(sess: requests.Session, filelink: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 32 and is_lha(dest.read_bytes()[:32]):
        return False
    last_error: Exception | None = None
    for url in lha_urls(filelink):
        try:
            response = sess.get(url, timeout=90)
            response.raise_for_status()
            data = response.content
            if is_lha(data):
                dest.write_bytes(data)
                return True
            last_error = ValueError(f"not an LHA archive from {url}")
        except requests.RequestException as error:
            last_error = error
            print(f"download fail {url}: {error}", flush=True)
            time.sleep(1)
    raise last_error or ValueError(f"not an LHA archive: {filelink}")


def extract_lha(archive: Path) -> None:
    try:
        import lhafile
    except ImportError:
        return

    out_dir = archive.parent / archive.stem
    if out_dir.exists() and any(out_dir.iterdir()):
        return

    try:
        lha = lhafile.Lhafile(str(archive))
        for info in lha.infolist():
            relative = Path(*Path(info.filename.replace("\\", "/")).parts)
            target = (out_dir / relative).resolve()
            if not str(target).startswith(str(out_dir.resolve())):
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if relative.parts:
                target.write_bytes(lha.read(info.filename))
    except Exception as error:  # noqa: BLE001
        print(f"extract skip {archive.name}: {error}", flush=True)


def existing_lha_index() -> dict[str, Path]:
    found: dict[str, Path] = {}
    if not DEST.exists():
        return found
    for path in DEST.rglob("*.lha"):
        found[path.stem.replace("_", " ").lower()] = path
        found[path.stem.lower()] = path
    return found


def seed_progress(progress: dict[str, str], titles: list[str]) -> dict[str, str]:
    existing = existing_lha_index()
    for title in titles:
        if title in progress:
            continue
        match = existing.get(title.lower()) or existing.get(title.replace(" ", "_").lower())
        if match is None:
            continue
        progress[title] = str(match.relative_to(DEST))
        extract_lha(match)
    return progress


def crawl_main(sess: requests.Session, skip_cdda: bool) -> bool:
    jobs = crawl_game_archives(sess, skip_cdda)
    if not jobs:
        return False

    downloaded = 0
    skipped = 0
    failed = 0
    progress = load_progress()

    for index, (link, dest) in enumerate(jobs, start=1):
        key = str(dest.relative_to(DEST))
        try:
            if dest.exists() and dest.stat().st_size > 32 and is_lha(dest.read_bytes()[:32]):
                extract_lha(dest)
                progress[key] = key
                skipped += 1
                if index % 50 == 0:
                    print(f"[{index}/{len(jobs)}] exists {dest.name}", flush=True)
                continue
            time.sleep(DELAY_S)
            fresh = download_lha(sess, link, dest)
            extract_lha(dest)
            progress[key] = key
            save_progress(progress)
            if fresh:
                downloaded += 1
                print(f"[{index}/{len(jobs)}] {dest.relative_to(DEST)}", flush=True)
            else:
                skipped += 1
        except Exception as error:  # noqa: BLE001
            failed += 1
            print(f"[{index}/{len(jobs)}] FAIL {dest.name}: {error}", flush=True)

    save_progress(progress)
    print(
        f"done downloaded={downloaded} skipped={skipped} failed={failed} dest={DEST}",
        flush=True,
    )
    return True


def main() -> int:
    skip_cdda = "--cdda" not in sys.argv
    force_wiki = "--wiki" in sys.argv
    DEST.mkdir(parents=True, exist_ok=True)
    sess = session()

    if not force_wiki and crawl_main(sess, skip_cdda):
        return 0

    print("falling back to wiki title list", flush=True)
    titles = list_titles(sess)
    print(f"UnExoticA games: {len(titles)}", flush=True)

    downloaded = 0
    skipped = 0
    failed = 0
    progress = seed_progress(load_progress(), titles)

    for index, title in enumerate(titles, start=1):
        try:
            cached = progress.get(title)
            if cached == "CDDA":
                skipped += 1
                continue
            if cached:
                dest = DEST / cached
                if dest.exists() and dest.stat().st_size > 32 and is_lha(dest.read_bytes()[:32]):
                    extract_lha(dest)
                    skipped += 1
                    try:
                        raw = sess.get(
                            WIKI_RAW,
                            params={"title": title.replace(" ", "_"), "action": "raw"},
                            timeout=45,
                        ).text
                        download_cover(sess, raw, dest)
                    except Exception:
                        pass
                    if index % 50 == 0:
                        print(f"[{index}/{len(titles)}] exists {dest.name}", flush=True)
                    continue

            time.sleep(DELAY_S)
            raw_response = sess.get(
                WIKI_RAW,
                params={"title": title.replace(" ", "_"), "action": "raw"},
                timeout=45,
            )
            if not raw_response.ok:
                print(f"[{index}/{len(titles)}] no file for {title}", flush=True)
                failed += 1
                continue
            match = FILE_RE.search(raw_response.text)
            link = match.group(1) if match else None
            if not link:
                print(f"[{index}/{len(titles)}] no file for {title}", flush=True)
                failed += 1
                continue
            if skip_cdda and "_CDDA" in link:
                progress[title] = "CDDA"
                save_progress(progress)
                skipped += 1
                continue
            dest = DEST / Path(link.removeprefix("media/audio/UnExoticA/"))
            time.sleep(DELAY_S)
            fresh = download_lha(sess, link, dest)
            extract_lha(dest)
            download_cover(sess, raw_response.text, dest)
            progress[title] = str(dest.relative_to(DEST))
            save_progress(progress)
            if fresh:
                downloaded += 1
                print(f"[{index}/{len(titles)}] {dest.relative_to(DEST)}", flush=True)
            else:
                skipped += 1
                if index % 50 == 0:
                    print(f"[{index}/{len(titles)}] exists {dest.name}", flush=True)
        except Exception as error:  # noqa: BLE001
            failed += 1
            print(f"[{index}/{len(titles)}] FAIL {title}: {error}", flush=True)

    save_progress(progress)

    print(
        f"done downloaded={downloaded} skipped={skipped} failed={failed} dest={DEST}",
        flush=True,
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
