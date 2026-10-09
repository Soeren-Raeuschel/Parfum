import security from "eslint-plugin-security";

export default [
  {
    ignores: ["dist/**", "src/App_old.js", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**"],
  },
  security.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
      "eqeqeq": "error",
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