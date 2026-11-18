#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
"""运行方式：python3 experiments/operations-acceptance.py <学堂项目路径>。需要 Node.js 24、npm 与 Python 3。
验收只操作临时项目副本，通过 HTTP 与 npm 验证数据库变化；退出时清理所有副本。
"""

import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
from urllib.parse import urlsplit
import tempfile
import time
import urllib.error
import urllib.request


def expect(condition, message):
    if not condition:
        raise RuntimeError(message)


class Instance:
    def __init__(self, root, project):
        self.project = root / "project"
        shutil.copytree(project, self.project, ignore=shutil.ignore_patterns(
            ".git", "node_modules", "data", "backups", "*.sqlite", "*.sqlite-*"))
        self.data = root / "instance"
        self.backups = root / "snapshots"
        self.record = self.data / "run.json"
        self.env = dict(os.environ, DATA_DIR=str(self.data), BACKUP_DIR=str(self.backups),
                        PORT="0", npm_config_offline="true", npm_config_update_notifier="false")
        self.log = (root / "service.log").open("w+")
        self.process = None

    def command(self, *args, success=True):
        process = subprocess.Popen(["npm", *args], cwd=self.project, env=self.env,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, start_new_session=True)
        try:
            output, _ = process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise RuntimeError(f"命令未在预期时间退出：npm {' '.join(args)}")
        expect((process.returncode == 0) == success,
               f"npm {' '.join(args)} 意外退出，状态 {process.returncode}\n{output}")
        return output

    def request(self, path, method="GET", payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(self.url + path, data=data, method=method,
                                         headers={"Content-Type": "application/json"})
        with self.client.open(request, timeout=4) as response:
            return json.load(response)

    def start(self):
        self.client = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.process = subprocess.Popen(["npm", "start"], cwd=self.project, env=self.env,
                                        start_new_session=True, stdout=self.log,
                                        stderr=subprocess.STDOUT)
        for _ in range(150):
            if self.process.poll() is not None:
                break
            try:
                record = json.loads(self.record.read_text())
                if not record.get("url"):
                    time.sleep(0.1)
                    continue
                self.url = record["url"].rstrip("/")
                self.health = self.request("/api/health")
                expect(self.health["ok"] is True, "健康检查失败")
                expect(self.record.stat().st_mode & 0o777 == 0o600, "运行记录权限不为 0600")
                self.request("/api/login", "POST", {"username": "admin", "password": "123456"})
                return record
            except (FileNotFoundError, ValueError, KeyError, urllib.error.URLError):
                time.sleep(0.1)
        self.log.flush()
        raise RuntimeError("启动失败：" + Path(self.log.name).read_text()[-1500:])

    def wait_stopped(self):
        expect(self.process.wait(timeout=15) == 0, "服务未正常退出")
        expect(not self.record.exists(), "停服后运行记录仍存在")
        self.process = None

    def stop(self):
        record = json.loads(self.record.read_text())
        request = urllib.request.Request(self.url + "/internal/stop", method="POST",
                                         headers={"x-maintenance-token": record["token"]})
        with self.client.open(request, timeout=5) as response:
            expect(response.status == 202, "维护接口未接受停服请求")
        self.wait_stopped()

    def close(self):
        if self.process is not None and self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait()
        self.log.close()


def verify(instance):
    record = instance.start()
    address = urlsplit(record["url"])
    expect(address.hostname in {"localhost", "127.0.0.1"} and address.port,
           "运行记录缺少实际本机端口")
    migrations = instance.health["migrations"]
    applied = migrations["applied"]
    expect(applied and migrations["pending"] == [], "初始库的迁移状态异常")
    courses = instance.request("/api/admin/courses")["courses"]
    expect(len(courses) == 4, "全新学堂应有四门示例课程")
    print(f"新库启动：端口 {address.port}，课程 {len(courses)} 门，已执行 {applied}")
    conflict = instance.command("start", success=False)
    expect(str(record["pid"]) in conflict and str(address.port) in conflict,
           "重复启动未报告占用实例的进程和端口")
    expect(instance.request("/api/health")["ok"], "原实例不再响应")
    print("重复启动：已拒绝，原实例健康")

    course = courses[0]
    path = f"/api/admin/courses/{course['id']}"
    def set_title(value):
        result = instance.request(path, "PATCH", {"title": value})["course"]
        expect(result["title"] == value, "课程更新未保存")

    def title():
        return instance.request(path)["course"]["title"]

    original = "运维验收·备份时"
    later = "运维验收·恢复前"
    set_title(original)
    instance.command("run", "backup")
    instance.wait_stopped()
    snapshots = list(instance.backups.glob("academy-*.sqlite"))
    expect(len(snapshots) == 1, "未找到唯一的新备份")
    snapshot = snapshots[0]
    with snapshot.open("rb") as stream:
        expect(stream.read(16) == b"SQLite format 3\0", "备份不是 SQLite 数据库文件")
    print(f"在线备份：自动停服，备份文件 {snapshot.name}")

    instance.start()
    expect(title() == original, "重启丢失备份时的业务值")
    set_title(later)
    instance.command("run", "restore", "--", str(snapshot), success=False)
    expect(title() == later, "被拒绝的在线恢复改变了业务值")
    instance.stop()
    instance.command("run", "restore", "--", str(snapshot))
    protected = list(instance.backups.glob("before-restore-*.sqlite"))
    expect(len(protected) == 1, "恢复前快照未生成")
    instance.start()
    expect(title() == original, "恢复后未读到备份时的课程标题")
    instance.stop()
    instance.command("run", "restore", "--", str(protected[0]))
    instance.start()
    expect(title() == later, "恢复前快照无法找回后来修改的标题")
    print(f"恢复：在线拒绝，旧快照读回“{original}”，恢复前快照读回“{later}”")
    instance.stop()

    # 仅改写验收脚本刚在临时目录内创建的测试库。
    database = instance.data / "academy.sqlite"
    damaged = b"synthetic unreadable SQLite database"
    database.write_bytes(damaged)
    backups_before = set(instance.backups.glob("before-restore-*.sqlite"))
    instance.command("run", "restore", "--", str(protected[0]))
    preserved = set(instance.backups.glob("before-restore-*.sqlite")) - backups_before
    expect(len(preserved) == 1 and next(iter(preserved)).read_bytes() == damaged,
           "恢复前未逐字节保留损坏的旧库")
    instance.start()
    expect(title() == later, "从完好快照恢复后未读回业务数据")
    instance.stop()
    print("故障恢复：保留损坏库全部原字节，从完好快照恢复后可登录并读回课程")

    directory = instance.project / "migrations"
    prefixes = [m[1] for file in directory.glob("*.sql")
                if (m := re.match(r"^(\d+)-", file.name))]
    expect(prefixes, "未找到编号迁移")
    number = str(max(map(int, prefixes)) + 1).zfill(max(map(len, prefixes)))
    filename = f"{number}-acceptance-probe.sql"
    (directory / filename).write_text(
        "CREATE TABLE acceptance_probe (id INTEGER PRIMARY KEY);\n"
        "INSERT INTO acceptance_probe (id) VALUES (1);\n")
    pending = instance.command("start", success=False)
    expect(filename in pending and not instance.record.exists(), "没有报告待迁移文件或启动未退出")
    migrated = instance.command("run", "migrate")
    expect(filename in migrated, "迁移命令未报告新增文件")
    instance.start()
    migrations = instance.health["migrations"]
    expect(migrations == {"applied": [*applied, filename], "pending": []}, "迁移后健康状态不符")
    expect(title() == later, "迁移重启后丢失原有课程标题")
    print(f"追加迁移：启动先拒绝，执行 {filename} 后重启成功，业务标题仍为“{later}”")
    next_number = str(int(number) + 1).zfill(len(number))
    pending_name = f"{next_number}-next-probe.sql"
    (directory / pending_name).write_text("SELECT 1;\n")
    live_state = instance.request("/api/health")["migrations"]
    expect(live_state["pending"] == [pending_name] and live_state["applied"] == migrations["applied"],
           f"运行中追加迁移后健康检查未反映待执行文件：{live_state}")
    print(f"在线健康检查：追加 {pending_name} 后，无需重启即可看到待执行文件")
    instance.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path, help="可运行学堂项目的根目录")
    project = parser.parse_args().project.resolve()
    with tempfile.TemporaryDirectory(prefix="academy-ops-") as workspace:
        instance = Instance(Path(workspace), project)
        try:
            verify(instance)
        finally:
            instance.close()
    print("运维验收全部通过。")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"验收失败：{error}", file=sys.stderr)
        sys.exit(1)
