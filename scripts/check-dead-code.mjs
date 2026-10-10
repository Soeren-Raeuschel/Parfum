#!/usr/bin/env node
/**
 * check-dead-code.mjs – Tot-Code-Check ohne externe Abhängigkeiten.
 *
 * Findet zwei Arten von totem Code:
 *  1. Verwaiste Dateien: Quellcode-Dateien in src/ und netlify/functions/,
 *     die von keiner anderen Datei importiert werden (Einstiegspunkte und
 *     Tests sind ausgenommen).
 *  2. Ungenutzte Deklarationen: Meldungen aus ESLint (no-unused-vars) werden
 *     per Wortgrenzen-Heuristik verifiziert, damit JSX-/Template-Vorkommen
 *     nicht als Fehlalarm zählen (gleiche Logik wie scripts/find_dead_code.py).
 *
 * Aufruf: node scripts/check-dead-code.mjs
 * Exit:   0 = kein toter Code, 1 = Tot-Code gefunden, 2 = Skript-Fehler
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const SRC_DIRS = ["src", "netlify/functions"];

// Einstiegspunkte & bekannte False-Positive-Kandidaten, die nie importiert werden
const ORPHAN_WHITELIST = [
  /(^|\/)main\.[jt]sx$/,
  /(^|\/)index\.[jt]sx?$/,
  /(^|\/)test\/setup\.[jt]s$/,
  /\.test\.[jt]sx?$/,
  /\.config\.[cm]?[jt]s$/,
  // Netlify-Functions werden zur Runtime per URL aufgerufen (z. B. /api/parfum/…)
  // und erscheinen deshalb nie im Import-Graph.
  /(^|\/)netlify\/functions\/[a-z-]+\.mjs$/,
];

/** Sammelt rekursiv alle Quellcode-Dateien unter dir (ohne node_modules/dist). */
function collectSourceFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // Verzeichnis existiert nicht → überspringen
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "__tests__", "test", "__pycache__"].includes(entry.name)) continue;
      collectSourceFiles(p, out);
    } else if (/\.(jsx?|mjs|tsx?)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Löst einen relativen Import-Spezifizierer relativ zu fromFile auf. */
function resolveImport(fromFile, spec) {
  const base = join(fromFile, "..", spec);
  for (const ext of ["", ".js", ".jsx", ".mjs", ".ts", ".tsx", "/index.js", "/index.jsx"]) {
    try {
      if (statSync(base + ext).isFile()) return base + ext;
    } catch { /* Kandidat existiert nicht → nächster */ }
  }
  return null;
}

// Erkennt: import ... from "./x" | export ... from "./x" | import("./x")
const IMPORT_RE = /import\s+[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|export\s+[^'"]*?from\s+['"](\.[^'"]+)['"]/g;

const files = SRC_DIRS.flatMap(dir => collectSourceFiles(join(ROOT, dir)));

// ── Relativer Import-Graph: targetFile -> Set<sourceFile> ───────────────────
const importers = new Map();
for (const file of files) {
  const src = readFileSync(file, "utf-8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    const resolved = resolveImport(file, spec);
    if (!resolved) continue;
    if (!importers.has(resolved)) importers.set(resolved, new Set());
    importers.get(resolved).add(file);
  }
}

// ── 1. Verwaiste Dateien ────────────────────────────────────────────────────
const deadFiles = files
  .filter(file => !ORPHAN_WHITELIST.some(re => re.test(file)))
  .filter(file => !importers.has(file))
  .map(f => relative(ROOT, f));

// ── 2. Ungenutzte Deklarationen via ESLint no-unused-vars ───────────────────
function findUnusedDeclarations() {
  const res = spawnSync(
    "npx",
    ["eslint", "src", "netlify/functions", "--format", "json", "--rule", '{"no-unused-vars":"error"}'],
    { encoding: "utf-8", shell: process.platform === "win32" }
  );
  let data;
  try { data = JSON.parse(res.stdout || "[]"); } catch { return []; }
  const found = [];
  for (const entry of data) {
    const lines = readFileSync(entry.filePath, "utf-8").split("\n");
    for (const msg of entry.messages || []) {
      if (msg.ruleId !== "no-unused-vars") continue;
      const name = msg.message.split("'")[1];
      if (!name) continue;
      // Wortgrenzen-Heuristik: kommt der Name außerhalb der Deklarationszeile vor?
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      const usedElsewhere = lines.some((line, i) => i + 1 !== msg.line && re.test(line));
      if (!usedElsewhere) {
        found.push(`${relative(ROOT, entry.filePath)}:${msg.line}  "${name}" wird nirgends genutzt`);
      }
    }
  }
  return found;
}

let unusedDecls = [];
try { unusedDecls = findUnusedDeclarations(); } catch (e) {
  console.error("Tot-Code-Check: ESLint-Auswertung fehlgeschlagen:", e.message);
  process.exit(2);
}

// ── Ausgabe ─────────────────────────────────────────────────────────────────
if (deadFiles.length || unusedDecls.length) {
  console.error("\n⛔ Tot-Code-Check fehlgeschlagen:\n");
  if (deadFiles.length) {
    console.error("  Verwaiste Dateien (werden nirgends importiert):");
    deadFiles.forEach(f => console.error(`    - ${f}`));
  }
  if (unusedDecls.length) {
    console.error("\n  Ungenutzte Deklarationen (ESLint no-unused-vars):");
    unusedDecls.forEach(l => console.error(`    - ${l}`));
  }
  console.error(`\n  ${deadFiles.length} verwaiste Datei(en), ${unusedDecls.length} ungenutzte Deklaration(en).`);
  process.exit(1);
} else {
  console.log("✓ Kein toter Code gefunden (verwaiste Dateien & ungenutzte Deklarationen).");
}
