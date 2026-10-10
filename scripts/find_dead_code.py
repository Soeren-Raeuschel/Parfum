#!/usr/bin/env python3
"""Analysiert ESLint-JSON-Ausgabe (no-unused-vars) und prüft je Variable,
ob sie außerhalb der Deklaration noch im Dateitext vorkommt (z. B. in JSX).
Ausgabe: Liste wirklich unbenutzter Namen (echter toter Code) vs. Fehlalarme.
Aufruf: python3 scripts/find_dead_code.py /tmp/eslint.json
"""
import json
import re
import sys

with open(sys.argv[1]) as f:
    data = json.load(f)

for entry in data:
    path = entry["filePath"]
    lines = open(path).readlines()
    text = "".join(lines)
    for msg in entry["messages"]:
        if msg.get("ruleId") != "no-unused-vars":
            continue
        name = re.search(r"'([^']+)'", msg["message"]).group(1)
        line_no = msg["line"]
        # Alle Vorkommen des Namens im Text zählen (Wortgrenze)
        occurrences = [i + 1 for i, line in enumerate(lines) if re.search(r"\b" + re.escape(name) + r"\b", line)]
        # Zeilen der Deklaration sind die gemeldete Zeile (+ ggf. Fortsetzungen
        # bei Mehrzeilen-Imports: solange nur "import"/Namen/Kommas)
        other = [ln for ln in occurrences if ln != line_no]
        status = "WIRKLICH UNGENUTZT" if not other else f"GENUTZT (Zeilen {other[:6]})"
        kind = msg["message"].split("'")[0].strip()
        print(f"{path.split('Parfum/')[-1]}:{line_no}  {name:<28} {kind:<40} -> {status}")
