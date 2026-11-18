# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
"""对比两个本地学堂中四门初始课程的持久资料。请使用独立示例库。"""

import argparse
from http.cookiejar import CookieJar
import json
from urllib.request import build_opener, HTTPCookieProcessor, Request

FIELDS = (
    "id", "title", "summary", "description", "instructor", "level", "levelLabel",
    "durationSeconds", "published", "url", "coverUrl", "videoFile",
)


def get_seed(url):
    client = build_opener(HTTPCookieProcessor(CookieJar()))
    base = url.rstrip("/")
    login = Request(base + "/api/login", data=b'{"username":"admin","password":"123456"}',
                    headers={"Content-Type": "application/json"})
    with client.open(login, timeout=10):
        pass
    with client.open(base + "/api/admin/courses", timeout=10) as response:
        courses = json.load(response)["courses"]
    return {course["id"]: course for course in courses if course["id"] in range(1, 5)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", help="原站地址")
    parser.add_argument("candidate", help="重铸站地址")
    args = parser.parse_args()
    reference = get_seed(args.reference)
    candidate = get_seed(args.candidate)
    matched = 0
    for course_id in range(1, 5):
        expected, actual = reference.get(course_id, {}), candidate.get(course_id, {})
        differences = [key for key in FIELDS if key not in expected or key not in actual
                       or type(expected[key]) is not type(actual[key]) or expected[key] != actual[key]]
        print(f"课程 {course_id}：" + ("差异字段 " + "、".join(differences) if differences else "资料一致"))
        matched += len(FIELDS) - len(differences)
    total = 4 * len(FIELDS)
    print(f"相同字段：{matched}/{total}")
    return int(matched != total)


if __name__ == "__main__":
    raise SystemExit(main())
