#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

set -euo pipefail
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
destination=${1:-"$project/media"}
mkdir -p -- "$destination"
scratch=$(mktemp -d "$destination/.make-media.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT

python3 - "$scratch" <<'PY'
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

output = Path(sys.argv[1])
courses = [
    ("python-basics", "Python", "Write your first program", "#67dfac"),
    ("git-essentials", "Git", "Keep track of every change", "#ffb184"),
    ("web-api-testing", "Web APIs", "Design and test an endpoint", "#a8a4ff"),
    ("sqlite-modeling", "SQLite", "Model data with tables", "#8ddaff"),
]
width, height = 800, 450
for number, (name, title, topic, accent) in enumerate(courses, 1):
    image = Image.new("RGB", (width, height), "#151e36")
    draw = ImageDraw.Draw(image)
    for y in range(height):
        shade = y / height
        draw.line((0, y, width, y), fill=(round(19 + 15 * shade), round(25 + 21 * shade), round(46 + 28 * shade)))
    draw.rounded_rectangle((40, 40, 760, 410), radius=24, outline="#4b5876", width=2)
    draw.rounded_rectangle((74, 78, 246, 116), radius=19, fill=accent)
    draw.text((90, 86), f"ACADEMY  /  {number:02d}", font=ImageFont.load_default(size=20), fill="#151e36")
    draw.text((74, 152), title, font=ImageFont.load_default(size=75), fill="#ffffff")
    draw.text((79, 248), topic, font=ImageFont.load_default(size=31), fill="#d9e3ff")
    draw.line((79, 351, 713, 351), fill=accent, width=3)
    image.save(output / f"{name}.png")
PY

while read -r name seconds; do
  ffmpeg -nostdin -loglevel error -loop 1 -framerate 24 -i "$scratch/$name.png" \
    -t "$seconds" -an -c:v libx264 -pix_fmt yuv420p -preset fast -movflags +faststart \
    "$scratch/$name.mp4"
  mv -f -- "$scratch/$name.mp4" "$destination/$name.mp4"
done <<'COURSES'
python-basics 18
git-essentials 20
web-api-testing 22
sqlite-modeling 16
COURSES
