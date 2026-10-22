#!/usr/bin/env python3
"""Measure how the assistant communicates, from the session transcripts. Standard library only.

    python -I tools/comm-audit.py [--days 30] [--root <dir>]

Reads `<config dir>/projects/*/*.jsonl` (the config dir is CLAUDE_CONFIG_DIR, else ~/.claude); sub-agent
transcripts (`subagents/`) and sidechains are excluded, so only what the user actually read is counted.
A "turn" is one human prompt and everything the assistant did until the next one; its *final* is the
last text block of the turn, after the last tool call.

What it prints (the numbers behind the `owner-80-20` output style, so a change of style can be judged):

  - finals: how many, length median / p90, share over 2,000 characters;
  - first line of a final: median / p90 length (the style asks for <= 140), share starting in bold;
  - long finals (over 2,000 characters): how many end on a question or an ask, and how many of those
    announce the decision in the first line;
  - finals ending in `?`, and how many are a "procedo?"-style permission ask;
  - emoji across all finals;
  - narration: text the assistant wrote *between* tool calls, per turn (median / p90 characters).

It reads files and prints; it never writes anywhere. Run it weekly and compare.
"""

import argparse
import json
import os
import re
import statistics
import sys
import time
from pathlib import Path

LONG_FINAL = 2000
SKIP_PREFIX = (
    "<system-reminder>", "<command-name>", "<local-command", "[Request interrupted", "<task-notification",
    "<bash-input", "<bash-stdout", "<ide_", "Caveat:",
)
PERMISSION_ASK = re.compile(r"\b(procedo|vuoi che|posso procedere|confermi|vado|shall i|should i proceed|want me to)\b", re.I)
ASK_AT_END = re.compile(r"\?\s*$|\b(procedo|confermi|vuoi che|scegli|decidi)\b", re.I)
DECISION_IN_LINE = re.compile(r"\?|serv(?:e|ono)|conferm|decision|scelt|via libera|\bok\b|decide|confirm", re.I)
EMOJI = re.compile("[✅❌⚠❗❓➡\U0001F300-\U0001FAFF]")


def config_dir() -> Path:
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")


def transcript_files(root: Path, days: int):
    cutoff = time.time() - days * 86400
    for path in sorted(root.glob("*/*.jsonl")):
        if path.parent.name == "subagents":
            continue
        try:
            if path.stat().st_mtime >= cutoff and path.stat().st_size >= 1000:
                yield path
        except OSError:
            continue


def human_text(entry):
    """What the user typed in this entry, or None for tool results and injected context."""
    content = entry.get("message", {}).get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        if not parts:
            return None
        text = "\n".join(parts)
    else:
        return None
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S).strip()
    if not text or text.startswith(SKIP_PREFIX) or "<command-name>" in text or "<task-notification" in text:
        return None
    return text


def read_turns(path: Path):
    """Yield `{texts}` (every assistant text block, in order) per human turn of one transcript."""
    turn = None
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("isSidechain"):
                continue
            kind = entry.get("type")
            if kind == "user" and not entry.get("isMeta") and human_text(entry) is not None:
                if turn:
                    yield turn
                turn = {"texts": []}
            elif kind == "assistant" and turn is not None:
                blocks = entry.get("message", {}).get("content")
                if not isinstance(blocks, list):
                    continue
                texts = [b.get("text", "") for b in blocks if b.get("type") == "text" and b.get("text", "").strip()]
                if texts:
                    turn["texts"].append("\n".join(texts))
    if turn:
        yield turn


def percentile(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))] if ordered else 0


def share(part, whole):
    return f"{100 * part / whole:.0f} %" if whole else "n/a"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Communication audit of the session transcripts.")
    parser.add_argument("--days", type=int, default=30, help="look back this many days (default 30)")
    parser.add_argument("--root", type=Path, default=None, help="projects directory (default <config dir>/projects)")
    args = parser.parse_args(argv)

    root = args.root or config_dir() / "projects"
    finals, narration, sessions = [], [], 0
    for path in transcript_files(root, args.days):
        sessions += 1
        for turn in read_turns(path):
            if turn["texts"]:
                finals.append(turn["texts"][-1])
            narration.append(sum(len(t) for t in turn["texts"][:-1]))   # everything but the final

    if not finals:
        print(f"comm-audit: no assistant finals under {root} in the last {args.days} days")
        return 0

    chars = [len(f) for f in finals]
    first_lines = [f.strip().splitlines()[0] for f in finals if f.strip()]
    first_len = [len(line) for line in first_lines]
    long_finals = [f for f in finals if len(f) > LONG_FINAL]
    asking = [f for f in long_finals if ASK_AT_END.search(f.strip()[-600:])]
    announced = [f for f in asking if DECISION_IN_LINE.search(f.strip().splitlines()[0])]
    question_finals = [f for f in finals if f.strip().endswith("?")]
    permission = [f for f in question_finals if PERMISSION_ASK.search(f[-400:])]
    emoji = sum(len(EMOJI.findall(f)) for f in finals)
    spoke_between = [n for n in narration if n > 0]

    print(f"sessions {sessions} | turns with a final {len(finals)} | last {args.days} days | root {root}")
    print(f"final length: median {statistics.median(chars):.0f}, p90 {percentile(chars, .9)}, over {LONG_FINAL}: {share(len(long_finals), len(finals))}")
    print(f"first line: median {statistics.median(first_len):.0f} chars, p90 {percentile(first_len, .9)}, "
          f"over 140: {share(sum(1 for n in first_len if n > 140), len(first_len))}, "
          f"starts in bold: {share(sum(1 for line in first_lines if line.lstrip().startswith('**')), len(first_lines))}")
    print(f"long finals ending on an ask: {len(asking)} of {len(long_finals)}; decision announced in line 1: {share(len(announced), len(asking))}")
    print(f"finals ending in '?': {len(question_finals)} ({share(len(question_finals), len(finals))}); permission asks ('procedo?'): {len(permission)}")
    print(f"emoji in finals: {emoji}")
    if spoke_between:
        print(f"narration between tools: {len(spoke_between)} turns, median {statistics.median(spoke_between):.0f} chars, p90 {percentile(spoke_between, .9)}")
    else:
        print("narration between tools: none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
