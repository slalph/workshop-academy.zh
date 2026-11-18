# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
"""通过浏览器验收学堂。请在独立示例库运行，管理流程会留下一个草稿。"""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
from urllib.parse import urlsplit
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright


COURSES = ("Python 入门：写出第一个程序", "用 Git 管好每一次修改", "Web 接口设计与测试")
DRAFT = "SQLite 数据建模实践"


def action(scope, pattern):
    name = re.compile(pattern)
    return scope.get_by_role("link", name=name).or_(
        scope.get_by_role("button", name=name)
    ).first


def login(page, account):
    page.get_by_role("textbox", name=re.compile("用户名|账号")).fill(account)
    page.get_by_label(re.compile("密码")).fill("123456")
    action(page, "^登录$").click()


def course_link(page, title):
    return page.get_by_role("link", name=re.compile(re.escape(title))).first


def status(page, url, expected):
    response = page.goto(url)
    if response is None or response.status != expected:
        actual = response.status if response else "无响应"
        raise AssertionError(f"期望 HTTP {expected}，实际为 {actual}")


def check_catalog(page, base, evidence):
    status(page, base, 200)
    body = page.locator("body")
    expect(body).to_contain_text(re.compile(r"1:00|1\s*分\s*0\s*秒|1分(?:钟)?|60\s*秒"))
    expect(body).to_contain_text(re.compile(r"3\s*门|已发布课程\s*3"))
    for title in COURSES:
        expect(course_link(page, title)).to_be_visible()
    expect(body).not_to_contain_text(DRAFT)
    evidence.append("首页列出三门已发布课程与一分钟总时长，草稿未出现")
    course_link(page, COURSES[0]).click()
    expect(body).to_contain_text("林知远")
    expect(body).to_contain_text("猜数字")
    expect(body).to_contain_text(re.compile(r"18\s*秒|0:18"))
    expect(action(page, "去登录|登录.*观看")).to_be_visible()
    evidence.append("从目录进入公开详情，可见讲师、课程内容、时长与登录入口")


def check_mobile(page, base, evidence):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(base)
    if page.evaluate("document.documentElement.scrollWidth > innerWidth"):
        raise AssertionError("390 像素宽度下首页出现水平溢出")
    course_link(page, COURSES[2]).click()
    expect(page.locator("body")).to_contain_text("陈墨")
    if page.evaluate("document.documentElement.scrollWidth > innerWidth"):
        raise AssertionError("390 像素宽度下详情出现水平溢出")
    evidence.append("390 像素宽的目录和详情均无水平溢出，第三门课程可点击进入")


def check_login(page, base, evidence):
    page.goto(base + "/courses/1")
    action(page, "去登录|登录.*观看").click()
    page.get_by_role("textbox", name=re.compile("用户名|账号")).fill("student")
    page.get_by_label(re.compile("密码")).fill("wrong")
    action(page, "^登录$").click()
    expect(page.locator("body")).to_contain_text(re.compile("错误|不正确|不匹配|无效"))
    evidence.append("错误密码可见提示")
    login(page, "student")
    page.wait_for_url(re.compile(r"/courses/1(?:[?#].*)?$"))
    page.reload()
    expect(action(page, "开始观看|播放|观看课程")).to_be_visible()
    expect(page.locator("body")).to_contain_text("李小明")
    action(page, "退出|注销").click()
    page.wait_for_url(base + "/")
    expect(action(page, "^登录$")).to_be_visible()
    evidence.append("重试成功返回原详情，刷新保持学员身份，退出后回到访客首页")


def check_access(page, base, evidence):
    status(page, base + "/courses/4", 404)
    page.goto(base + "/admin")
    expect(page.get_by_label(re.compile("密码"))).to_be_visible()
    evidence.append("访客访问草稿详情得到 404，访问管理页进入登录")
    action(page, "陈小红|student2").click()
    page.wait_for_url(re.compile(r"/admin(?:[?#].*)?$"))
    status(page, base + "/admin", 403)
    expect(page.locator("body")).to_contain_text(re.compile("权限|管理员"))
    evidence.append("示例学员一键登录返回原管理地址，得到 403 和权限提示")


def check_playback(page, base, evidence):
    page.goto(base + "/login")
    login(page, "student")
    expect(action(page, "退出|注销")).to_be_visible()
    page.goto(base + "/courses/1")
    action(page, "开始观看|播放|观看课程").click()
    player = page.locator("video").first
    expect(player).to_be_visible()
    player.evaluate("""async v => {
      v.muted = true;
      await Promise.race([
        v.play(),
        new Promise((_, reject) => setTimeout(() => reject(Error('视频启动超时')), 6000))
      ]);
    }""")
    start = player.evaluate("v => v.currentTime")
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        state = player.evaluate("v => [v.currentTime, v.duration, v.readyState, v.error?.code]")
        if state[2] >= 2 and not state[3] and state[1] and state[0] - start > 0.5:
            evidence.append(f"真实视频时长 {state[1]:.2f} 秒，播放位置从 {start:.2f} 推进到 {state[0]:.2f} 秒")
            return
        page.wait_for_timeout(150)
    raise AssertionError(f"播放器未推进半秒，最终状态 {state}")


def fill_course(page, title, updated=False):
    values = (
        ("标题|名称", title), ("一句话|简介|摘要", "编辑后的课程摘要" if updated else "建立草稿时的摘要"),
        ("介绍|详情|正文", "编辑后的第一段。\n\n编辑后的第二段。" if updated else "建立时的正文。"),
        ("讲师|教师", "编辑讲师" if updated else "初始讲师")
    )
    for label, value in values:
        page.get_by_role("textbox", name=re.compile(label)).fill(value)
    difficulty = page.get_by_role("combobox", name=re.compile("难度|级别"))
    difficulty.select_option(label="高级" if updated else "入门")
    videos = page.get_by_role("combobox", name=re.compile("视频|媒体"))
    filename = "git-essentials.mp4" if updated else "python-basics.mp4"
    label = videos.get_by_role("option", name=re.compile(re.escape(filename))).inner_text()
    videos.select_option(label=label)


def course_row(page, title):
    for role in ("row", "listitem", "article", "group", "region"):
        matches = page.get_by_role(role).filter(has_text=title)
        if matches.count() == 1:
            return matches
    # 无语义容器的卡片，取同时包含唯一标题及发布按钮的最近祖先。
    return page.get_by_text(title, exact=True).first.locator(
        "xpath=ancestor::*[.//*[self::button or self::a][contains(normalize-space(.),'发布') or contains(normalize-space(.),'下架')]][1]"
    )


def check_management(page, base, evidence):
    guest = page.context.browser.new_context()
    try:
        visitor = guest.new_page()
        page.goto(base + "/login")
        login(page, "admin")
        expect(action(page, "课程管理|管理课程")).to_be_visible()
        action(page, "课程管理|管理课程").click()
        action(page, "新建课程|新增课程|创建课程").click()
        original = "浏览验收" + uuid4().hex[:8]
        updated = original + "更新"
        fill_course(page, original)
        action(page, "创建课程|保存草稿|保存课程|^保存$").click()
        expect(page.get_by_text(original, exact=True).first).to_be_visible()
        page.reload()
        row = course_row(page, original)
        expect(row).to_contain_text("草稿")
        visitor.goto(base)
        expect(visitor.locator("body")).not_to_contain_text(original)
        evidence.append("创建草稿后刷新管理列表仍存在，访客目录无该课程")
        action(row, "编辑").click()
        fill_course(page, updated, updated=True)
        action(page, "保存|更新").click()
        expect(page.get_by_text(updated, exact=True).first).to_be_visible()
        row = course_row(page, updated)
        action(row, "^发布$|^发布课程$|^上架$").click()
        expect(row).to_contain_text("已发布")
        page.reload()
        expect(course_row(page, updated)).to_contain_text("已发布")
        visitor.reload()
        course_link(visitor, updated).click()
        detail_url = visitor.url
        for value in (updated, "编辑后的课程摘要", "编辑讲师", "高级", "编辑后的第一段。", "编辑后的第二段。"):
            expect(visitor.locator("body")).to_contain_text(value)
        expect(visitor.locator("body")).to_contain_text(re.compile(r"20\s*秒|0:20"))
        evidence.append("编辑标题、简介、正文两段、讲师、难度、视频后发布，访客刷新目录可进入并核实全部字段及新视频时长")
        action(course_row(page, updated), "取消发布|下架|撤回发布").click()
        expect(course_row(page, updated)).to_contain_text("草稿")
        page.reload()
        expect(course_row(page, updated)).to_contain_text("草稿")
        status(visitor, detail_url, 404)
        visitor.goto(base)
        expect(visitor.locator("body")).not_to_contain_text(updated)
        evidence.append("下架后刷新保留草稿状态，访客目录不显示，原详情返回 404")
    finally:
        guest.close()


def expect_feedback(page, title, state):
    # 一条提交结果应同时说明操作和结果状态。允许提示条、消息段落或对话框。
    messages = page.get_by_text(re.compile("已保存|已创建|已新建|创建成功|新建成功|保存成功|更新成功|已更新"))
    for pattern in (re.compile(re.escape(title)), re.compile(state)):
        messages = messages.filter(has_text=pattern)
    expect(messages.first).to_be_visible()


def check_published_editor(page, base, evidence):
    visitor = page.context.browser.new_context()
    try:
        guest = visitor.new_page()
        title = "发布验收" + uuid4().hex[:8]
        page.goto(base + "/login")
        login(page, "admin")
        action(page, "课程管理|管理课程").click()
        action(page, "新建课程|创建课程|新增课程").click()
        fill_course(page, title)
        publish = page.get_by_role("checkbox", name=re.compile("发布|上架"))
        expect(publish).not_to_be_checked()
        publish.check()
        action(page, "创建课程|保存课程|^保存$").click()
        expect_feedback(page, title, "已发布|已上架|已公开")
        guest.goto(base)
        course_link(guest, title).click()
        detail = guest.url
        evidence.append("新课勾选立即发布，提交结果指出课程和发布状态，访客立即可打开详情")
        action(course_row(page, title), "编辑").click()
        editor = page.url
        publish = page.get_by_role("checkbox", name=re.compile("发布|上架"))
        expect(publish).to_be_checked()
        preview = action(page, "在目录中查看|预览|查看.*课程|查看.*详情|查看.*公开")
        preview.click()
        page.wait_for_url(detail)
        page.go_back()
        page.wait_for_url(editor)
        page.get_by_role("textbox", name=re.compile("标题|名称")).fill("未提交的课程名")
        action(page, "取消|放弃").click()
        expect(course_row(page, title)).to_be_visible()
        guest.reload()
        expect(guest.locator("body")).to_contain_text(title)
        expect(guest.locator("body")).not_to_contain_text("未提交的课程名")
        evidence.append("已发布课的编辑页显示选中状态，可打开公开详情；返回修改标题并取消，访客仍见原值")
        action(course_row(page, title), "编辑").click()
        # 仅切换是否发布，其他表单字段保持原值。
        publish.uncheck()
        action(page, "保存|更新").click()
        expect_feedback(page, title, "草稿|已下架|未发布")
        status(guest, detail, 404)
        action(course_row(page, title), "编辑").click()
        expect(publish).not_to_be_checked()
        expect(preview).to_have_count(0)
        expect(page.get_by_role("textbox", name=re.compile("标题|名称"))).to_have_value(title)
        evidence.append("仅取消发布并保存，反馈明确为草稿；旧详情返回 404；重进编辑原值保留，发布未勾选，公开详情入口消失")
    finally:
        visitor.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="独立实例的地址")
    parser.add_argument("report", type=Path, help="验收报告 JSON 路径")
    parser.add_argument("--chromium", default=os.environ.get("CHROMIUM") or shutil.which("chromium"))
    args = parser.parse_args()
    base = args.url.rstrip("/")
    if urlsplit(base).scheme not in ("http", "https"):
        parser.error("请提供 HTTP 或 HTTPS 地址")
    flows = [
        ("catalog", "公开目录和详情", check_catalog), ("mobile", "移动端访问", check_mobile),
        ("login", "登录返回与退出", check_login), ("access", "访客与学员权限", check_access),
        ("playback", "真实视频播放", check_playback), ("management", "课程管理与访客可见性", check_management),
        ("published_editor", "已发布课程的编辑、取消与下架", check_published_editor)
    ]
    results = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium)
        for key, name, run in flows:
            context = browser.new_context(viewport={"width": 1280, "height": 900})
            page = context.new_page()
            page.set_default_timeout(5000)
            evidence = []
            entry = {"name": name, "evidence": evidence}
            try:
                run(page, base, evidence)
                entry["status"] = "pass"
            except Exception as error:
                entry.update(status="fail", error=str(error), page=urlsplit(page.url).path)
            finally:
                context.close()
            results[key] = entry
        browser.close()
    report = {"url": base, "passed": all(e["status"] == "pass" for e in results.values()), "flows": results}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"验收{'通过' if report['passed'] else '失败'}，报告已保存到 {args.report}")
    return int(not report["passed"])


if __name__ == "__main__":
    sys.exit(main())
