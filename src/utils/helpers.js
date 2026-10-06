/**
 * Hilfsfunktionen für Parfum-App
 * 
 * Diese Datei fasst die wiederverwendbaren Hilfsfunktionen zusammen,
 * damit sie einfach getestet werden können.
 */

/**
 * Teilt einen String mit Parfümnoten in ein Array auf.
 * Trennt an Kommas oder · (Mittelpunkt).
 * 
 * @param {string} val - Eingabe-String mit Noten
 * @returns {string[]} Array von bereinigten Noten
 */
export function splitNotes(val) {
  if (!val) return [];
  return val.replace(/\s*·\s*/g, ",").split(",").map(n => n.trim()).filter(Boolean);
}

/**
 * Bereinigt Benutzereingaben: Entfernt Zeilenumbrüche, Tabulatoren, trimmt.
 * Schützt gegen Injection und ungültige Zeichen.
 * 
 * @param {*} v - Eingabewert (kann null, undefined, string, number sein)
 * @returns {string} Bereinigter String
 */
export function sanitizeField(v) {
  return (v === null || v === undefined ? "" : String(v)).replace(/[\t\r\n]/g, " ").trim();
}

/**
 * Debounce-Funktion: Führt eine Funktion nur nach einer Verzögerung aus.
 * Wird z.B. für Sucheingaben verwendet (300ms Verzögerung).
 * 
 * @param {Function} fn - Auszuführende Funktion
 * @param {number} delay - Verzögerung in Millisekunden
 * @returns {Function} Debounced-Funktion
 */
export function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}