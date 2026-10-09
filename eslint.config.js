import security from "eslint-plugin-security";
import globals from "globals";
import js from "@eslint/js";

export default [
  {
    // legacy/ ist eingefrohrener Altcode und wird bewusst nicht mehr gelintet,
    // damit die strengeren Regeln dort keine irrelevanten Fehler melden.
    ignores: ["dist/**", "src/App_old.js", "legacy/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**"],
  },
  // Fix: Basis-Regelwerk (enthält u. a. no-undef, no-dupe-keys, no-unreachable,
  // no-fallthrough, no-self-assign, no-async-promise-executor ...) – fängt
  // typische Laufzeit-Crasher ab, bevor sie auf dem Gerät passieren.
  js.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        // Vitest-Jest-kompatible Globals für Testdateien
        describe: "readonly", it: "readonly", test: "readonly", expect: "readonly",
        beforeEach: "readonly", afterEach: "readonly", beforeAll: "readonly", afterAll: "readonly",
        vi: "readonly",
      },
    },
    rules: {
      // ── Abfänger für Runtime-Crasher (Fehler, nicht nur Warnungen) ──
      // ReferenceError-Klasse wie "Can't find variable: playClick":
      "no-undef": "error",
      // Tippfehler in bedingten Zuweisungen / Vergleichen:
      "no-cond-assign": "error",
      "no-constant-binary-expression": "error",
      // Gelöschte Objekt-/Array-Eigenschaften, dupe keys etc.:
      "no-dupe-else-if": "error",
      "no-prototype-builtins": "error",
      // Promises/Await-Fehler (verlorene Fehler = stiller Crash):
      "no-async-promise-executor": "error",
      "no-promise-executor-return": "error",
      "require-atomic-updates": "error",
      // try/catch- & throw-Fehler:
      "no-throw-literal": "error",
      "no-useless-catch": "error",
      // Sonstige typische Bug-Muster:
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "no-unmodified-loop-condition": "error",
      "no-return-assign": ["error", "always"],
      "no-sequences": "error",
      "default-case-last": "error",
      "no-new-native-nonconstructor": "error",
      "no-shadow-restricted-names": "error",

      // ── Stil-Bugs als Warnungen (blockieren Deploy nicht, aber auffällig) ──
      "no-unused-vars": "error",
      "no-shadow": "warn",
      "prefer-const": "warn",
      "no-var": "error",
      "eqeqeq": "error",
      // Leere catch-Blöcke sind hier bewusst (Fehler still ignorieren) –
      // aber echte leere Blöcke außerhalb von catch bleiben verboten:
      "no-empty": ["error", { allowEmptyCatch: true }],
      // request-guard.mjs säubert Kontrollzeichen (\x00, \x1f) absichtlich
      // per Regex -> Fehlalarm, daher aus:
      "no-control-regex": "off",
      // detect-object-injection deaktiviert (begründet):
      // Die Regel meldet jeden dynamischen Objektzugriff (obj[key]) als
      // potenzielle Injection. Im Projekt sind das aber ausschließlich
      // Whitelist-/Lookup-Muster gegen statische Konstanten
      // (z. B. NOTE_TO_CAT[note], FILL_COLORS[level], _gtmState[m.id]) –
      // Schlüssel stammen aus eigener Datenhaltung, nie aus User-Input
      // gegenüber sensiblen Objekten wie prototype. Ein echtes Risiko ist
      // hier nicht erkennbar; die ~80 Fehlalarme überdeckten sonst alle
      // relevanten Security-Hinweise.
      "security/detect-object-injection": "off"
    }
  }
];