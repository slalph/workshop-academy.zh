# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
"""用真实墙钟验证已签发课程地址到期，并使用重新签发的地址读取下一段字节。"""
import argparse
from datetime import datetime, timezone
import http.cookiejar
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, Request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("url")
parser.add_argument("report", type=Path)
args = parser.parse_args()
base = args.url.rstrip("/")
session = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
reader = build_opener()
events = []


def record(label, **details):
    events.append(dict(event=label, utc=datetime.now(timezone.utc).isoformat(), **details))


def post(path, data):
    request = Request(base + path, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    with session.open(request, timeout=10) as response:
        return json.load(response)


def issue():
    before = time.time()
    result = post("/api/courses/1/play", {})
    remaining = result["expiresAt"] / 1000 - before
    record("签发播放地址", validitySeconds=round(remaining, 3))
    assert 59 <= remaining <= 61, "授权时长偏离 60 秒"
    return result


def read_range(grant, offset, expected):
    request = Request(base + grant["url"], headers={"Range": f"bytes={offset}-{offset + 63}"})
    try:
        response = reader.open(request, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        record("独立无会话客户端读取", offset=offset, status=response.status, length=len(body))
        assert response.status == expected
        if expected == 206:
            assert len(body) == 64
            assert response.headers["Content-Range"].startswith(f"bytes {offset}-{offset + 63}/")


passed = False
try:
    post("/api/login", {"username": "student", "password": "123456"})
    original = issue()
    read_range(original, 0, 206)
    time.sleep(max(0, original["expiresAt"] / 1000 - time.time() + 0.25))
    read_range(original, 64, 410)
    replacement = issue()
    assert replacement["url"] != original["url"]
    read_range(replacement, 64, 206)
    passed = True
except Exception as error:
    record("验收失败", detail=repr(error))
finally:
    args.report.write_text(json.dumps(dict(passed=passed, events=events), indent=2, ensure_ascii=False) + "\n")
raise SystemExit(not passed)
