"""Convert all-sessions.md into structured JSON."""

import json
import re
from pathlib import Path

KNOWN_TAGS_LOWER = {
    "productivity", "engineering management", "tech leadership", "cloud", "ai",
    "backend", "javascript", "full-stack", "devops", "security",
    "jsworld conference", "diversity and inclusion", "product management",
    "data & analytics", "workshop", "networking",
}

DURATION_RE = re.compile(r"^(\d+\s+Hours?(\s+\d+\s+Minutes?)?|\d+\s+Minutes?)$")
TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")
SEPARATOR = "---"
SKIP_LINES = {"Free", "Register"}


def is_tag(line: str) -> bool:
    return line.strip().lower() in KNOWN_TAGS_LOWER


def is_duration(line: str) -> bool:
    return bool(DURATION_RE.match(line.strip()))


def is_time(line: str) -> bool:
    return bool(TIME_RE.match(line.strip()))


def parse(path: Path) -> list[dict]:
    lines = path.read_text().split("\n")
    n = len(lines)

    durations = [i for i, l in enumerate(lines) if is_duration(l)]
    time_markers = {i: lines[i].strip() for i in range(n) if is_time(lines[i])}

    title_indices = []
    for dur_i in durations:
        ti = dur_i - 1
        while ti >= 0 and lines[ti].strip() == "":
            ti -= 1
        title_indices.append(ti)

    sessions = []
    current_time = None

    for s_idx, dur_i in enumerate(durations):
        title_idx = title_indices[s_idx]

        scan_from = 0 if s_idx == 0 else durations[s_idx - 1] + 3
        for ti in sorted(time_markers.keys()):
            if scan_from <= ti < title_idx:
                current_time = time_markers[ti]

        title = lines[title_idx].strip()
        duration = lines[dur_i].strip()

        location = ""
        stage = ""
        body_start = dur_i + 1

        if body_start < n:
            l1 = lines[body_start].strip()
            if l1 == "All Tracks":
                location = "All Tracks"
                body_start += 1
            else:
                location = l1
                body_start += 1
                if body_start < n:
                    stage = lines[body_start].strip()
                    body_start += 1

        while body_start < n and lines[body_start].strip() in SKIP_LINES:
            body_start += 1

        body_end = title_indices[s_idx + 1] if s_idx + 1 < len(durations) else n
        body = lines[body_start:body_end]

        tags = []
        end_idx = len(body) - 1
        while end_idx >= 0:
            line = body[end_idx].strip()
            if line == "" or line == SEPARATOR or line in SKIP_LINES:
                end_idx -= 1
                continue
            if is_time(line):
                end_idx -= 1
                continue
            if is_tag(line):
                tags.insert(0, line)
                end_idx -= 1
                continue
            break

        speakers = []
        sp_idx = end_idx
        while sp_idx >= 0:
            line = body[sp_idx].strip()
            if line == "" or line == SEPARATOR:
                break
            if (
                len(line) > 80
                or len(line.split()) > 5
                or line.endswith(".")
                or line.endswith("?")
                or line.endswith(":")
                or line.endswith(",")
                or line.endswith("!")
            ):
                break
            speakers.insert(0, line)
            sp_idx -= 1
        end_idx = sp_idx

        desc_lines = body[: end_idx + 1]
        desc_lines = [l for l in desc_lines if l.strip() not in SKIP_LINES]
        while desc_lines and desc_lines[-1].strip() in ("", SEPARATOR):
            desc_lines.pop()
        while desc_lines and desc_lines[0].strip() in ("", SEPARATOR):
            desc_lines.pop(0)

        cleaned = []
        prev_blank = False
        for l in desc_lines:
            if l.strip() == "":
                if not prev_blank:
                    cleaned.append("")
                prev_blank = True
            else:
                cleaned.append(l.rstrip())
                prev_blank = False
        description = "\n".join(cleaned).strip()

        tags_unique = list(dict.fromkeys(tags))

        sessions.append({
            "title": title,
            "time": current_time,
            "duration": duration,
            "location": location,
            "stage": stage,
            "speakers": speakers,
            "tags": tags_unique,
            "description": description,
        })

    return sessions


if __name__ == "__main__":
    src = Path("/Users/ddezeeuw/Projects/devworld26/.claude/references/all-sessions.md")
    dst = Path("/Users/ddezeeuw/Projects/devworld26/.claude/references/all-sessions.json")
    sessions = parse(src)
    dst.write_text(json.dumps(sessions, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(sessions)} sessions to {dst}")
