"""Join speakers in sessions.json against the schema.org performer list in
detailed-context.json so each session carries `speakerInfo[]` entries with
company + job title.

Matching strategy, in order:
  1. Exact lowercase match on the full name string.
  2. Normalized match: strip dots, extra spaces, lower-case.
  3. Last-name match (last whitespace-separated token), used when the
     session string is a username-only handle ("muhammedsalihguler") and the
     performer's name is the full form ("muhammedsalihguler Surname").
  4. Initials match: if the session string is 1-4 chars, treat it as an
     initials prefix and look for performers whose first+last initials match.

Unresolved names are logged so we can hand-fix or extend heuristics.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


SESSIONS_PATH = Path(
    "/Users/ddezeeuw/Projects/devworld26/data/sessions.json"
)
CONTEXT_PATH = Path(
    "/Users/ddezeeuw/Projects/devworld26/.claude/references/detailed-context.json"
)


def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().replace(".", " ").strip())


def initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    return "".join(p[0].lower() for p in parts if p[0].isalpha())


def last_name(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    return parts[-1].lower() if parts else ""


def first_name(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    return parts[0].lower() if parts else ""


def build_index(performers: list[dict]) -> dict:
    """Returns dict with multiple lookup tables."""
    by_full = {}
    by_norm = {}
    by_last = {}
    by_first = {}
    by_initials = {}
    for p in performers:
        name = (p.get("name") or "").strip()
        if not name:
            continue
        info = {
            "name": name,
            "company": p.get("worksFor") or "",
            "jobTitle": p.get("jobTitle") or "",
            "url": p.get("url") or "",
        }
        by_full.setdefault(name.lower(), info)
        by_norm.setdefault(normalize(name), info)
        ln = last_name(name)
        if ln:
            by_last.setdefault(ln, info)
        fn = first_name(name)
        if fn:
            by_first.setdefault(fn, info)
        ini = initials(name)
        if 2 <= len(ini) <= 4:
            by_initials.setdefault(ini, info)
    return {
        "full": by_full,
        "norm": by_norm,
        "last": by_last,
        "first": by_first,
        "initials": by_initials,
    }


def match_speaker(raw: str, idx: dict) -> dict | None:
    raw = (raw or "").strip()
    if not raw:
        return None

    # 1. exact lowercase
    hit = idx["full"].get(raw.lower())
    if hit:
        return hit

    # 2. normalized
    hit = idx["norm"].get(normalize(raw))
    if hit:
        return hit

    # 3. last-name single-token match (handles "muhammedsalihguler" type
    # handles where the session has only the username and performer record
    # has "username Surname")
    tokens = [t for t in re.split(r"\s+", raw) if t]
    if len(tokens) == 1:
        hit = idx["first"].get(tokens[0].lower()) or idx["last"].get(tokens[0].lower())
        if hit:
            return hit

    # 4. initials / unique-prefix (only for very short strings the parser
    # truncated — "Sr" → "Srini V Srinivasan", "In" → "Ingrid Tappin").
    if 1 <= len(raw) <= 4 and raw.replace(" ", "").isalpha():
        ini = raw.replace(" ", "").lower()

        # exact initials hit ("hg" → first+last initials match)
        hit = idx["initials"].get(ini)
        if hit:
            return hit

        # unique first-name prefix
        first_hits = list({
            id(info): info
            for perf_name, info in idx["full"].items()
            if first_name(perf_name).startswith(ini)
        }.values())
        if len(first_hits) == 1:
            return first_hits[0]

        # unique last-name prefix
        last_hits = list({
            id(info): info
            for perf_name, info in idx["full"].items()
            if last_name(perf_name).startswith(ini)
        }.values())
        if len(last_hits) == 1:
            return last_hits[0]

        # unique first+last initial combination
        combo_hits = list({
            id(info): info
            for perf_name, info in idx["full"].items()
            if (first_name(perf_name)[:1] + last_name(perf_name)[:1]) == ini
        }.values())
        if len(combo_hits) == 1:
            return combo_hits[0]

    return None


def main() -> int:
    sessions = json.loads(SESSIONS_PATH.read_text())
    context = json.loads(CONTEXT_PATH.read_text())
    performers = context.get("performer", [])
    print(
        f"Loaded {len(sessions)} sessions and {len(performers)} performers.",
        file=sys.stderr,
    )

    idx = build_index(performers)

    resolved = 0
    unresolved = []
    for session in sessions:
        speakers = session.get("speakers") or []
        info_list = []
        for raw in speakers:
            hit = match_speaker(raw, idx)
            if hit:
                resolved += 1
                info_list.append(
                    {
                        "raw": raw,
                        "name": hit["name"],
                        "company": hit["company"],
                        "jobTitle": hit["jobTitle"],
                    }
                )
            else:
                unresolved.append((session.get("title", "?")[:60], raw))
                info_list.append({"raw": raw, "name": raw, "company": "", "jobTitle": ""})
        session["speakerInfo"] = info_list

    SESSIONS_PATH.write_text(
        json.dumps(sessions, indent=2, ensure_ascii=False) + "\n"
    )

    print(
        f"Wrote {SESSIONS_PATH}.  Resolved {resolved} speakers.",
        file=sys.stderr,
    )
    if unresolved:
        print(f"\nUnresolved ({len(unresolved)}):", file=sys.stderr)
        for title, raw in unresolved:
            print(f"  {raw!r:40s} in '{title}'", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
