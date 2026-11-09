#!/usr/bin/env python3
"""Validate a state.json (local file or SAS URL) against the v1 schema and size budget.

  python3 tools/check_state.py docs/state.example.json
  python3 tools/check_state.py "$READ_SAS_URL"
"""
import json, re, sys, urllib.request

LIMIT = 6 * 1024
MACROS = ("kcal", "p", "c", "f")
errs = []
warns = []

def need(cond, msg):
    if not cond:
        errs.append(msg)

def ints(d, where):
    need(isinstance(d, dict), f"{where} must be an object")
    if isinstance(d, dict):
        for k in MACROS:
            v = d.get(k)
            if isinstance(v, str) and re.fullmatch(r"-?\d+(\.\d+)?", v):
                warns.append(f"{where}.{k} is a string ('{v}'); watch copes, but fix the Shortcut Dictionary field type to Number")
            else:
                need(isinstance(v, int), f"{where}.{k} must be an integer")

def main(src):
    if src.startswith("https://"):
        with urllib.request.urlopen(src, timeout=15) as r:
            ctype = r.headers.get("Content-Type", "")
            raw = r.read()
        need(ctype.startswith("application/json"), f"Content-Type is '{ctype}', watch needs application/json")
    else:
        raw = open(src, "rb").read()

    need(len(raw) <= LIMIT, f"size {len(raw)} B exceeds {LIMIT} B budget")
    s = json.loads(raw)
    need(s.get("v") == 1, "v must be 1")
    need(re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(s.get("date"))), "date must be YYYY-MM-DD")
    need(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)", str(s.get("updated"))),
         "updated must be ISO 8601 with offset, e.g. 2026-11-09T14:05:00-08:00")
    ints(s.get("targets"), "targets")
    ints(s.get("consumed"), "consumed")
    need(isinstance(s.get("water_ml"), int), "water_ml must be an integer")
    w = s.get("weight", {})
    for k in ("scale", "trend", "goal"):
        need(isinstance(w.get(k), (int, float)), f"weight.{k} must be a number")
    need(isinstance(w.get("expenditure"), int), "weight.expenditure must be an integer")
    week = s.get("week", [])
    need(isinstance(week, list) and len(week) <= 7, "week must be a list of at most 7 days")
    for i, d in enumerate(week):
        ints(d, f"week[{i}]")
    ids = set()
    for i, st in enumerate(s.get("staples", [])):
        ints(st, f"staples[{i}]")
        need(isinstance(st.get("id"), str) and st["id"] not in ids, f"staples[{i}].id missing or duplicate")
        ids.add(st.get("id"))
    need(len(ids) <= 10, "keep staples to 10 or fewer (watch menu + memory)")

    for w_ in warns:
        print("WARN", w_)
    print(f"{len(raw)} B, {len(week)} days, {len(ids)} staples")
    if errs:
        print("FAIL\n  " + "\n  ".join(errs)); sys.exit(1)
    print("OK")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docs/state.example.json")
