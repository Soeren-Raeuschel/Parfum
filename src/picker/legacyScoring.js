/**
 * legacyScoring.js – Kontext-Kataloge für den "Parfum des Tages"-Picker.
 *
 * Enthält die aktiven Daten, die App.jsx (HeuteTab-Chips, Validierung,
 * Parfumo-Lookup) direkt nutzt: getSeason, FAMILY_CONTEXT, MOODS, TIMES,
 * WEATHERS, OCCASIONS, INTENSITIES, LONGEVITIES.
 *
 * Die frühere generateRecommendations-Scoring-Engine wurde entfernt –
 * die Auswahl läuft über scoring.js + todayIntegration.js
 * (alter Code ist in der Git-Historie von App.jsx / legacyScoring.js erhalten).
 *
 * Keine UI-/React-Abhängigkeit.
 */

function getSeason() {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return "Frühling";
  if (m >= 6 && m <= 8) return "Sommer";
  if (m >= 9 && m <= 11) return "Herbst";
  return "Winter";
}

// ── Scoring constants ─────────────────────────────────────────────────────────
// ── FAMILY CONTEXT MAPPING ─────────────────────────────────────────────────
// Maps families to their best contexts (season, weather, occasion, time, mood)
const FAMILY_CONTEXT = {
  Floral: { seasons: ["Frühling", "Sommer"], weather: ["sunny", "cloudy"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["romantic", "calm", "playful"] },
  Woody: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["work", "evening", "date"], times: ["evening", "night"], moods: ["confident", "mysterious", "calm"] },
  Oriental: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "date", "outdoor"], times: ["evening", "night"], moods: ["romantic", "confident", "mysterious"] },
  Fresh: { seasons: ["Frühling", "Sommer"], weather: ["sunny", "hot"], occasions: ["sport", "casual", "outdoor"], times: ["morning", "afternoon"], moods: ["energetic", "playful", "calm"] },
  Chypre: { seasons: ["Herbst", "Winter", "Ganzjährig"], weather: ["cold", "rainy", "cloudy"], occasions: ["work", "evening", "outdoor"], times: ["afternoon", "evening"], moods: ["confident", "mysterious", "calm"] },
  "Fougère": { seasons: ["Ganzjährig"], weather: ["cloudy", "rainy"], occasions: ["work", "casual"], times: ["morning", "afternoon"], moods: ["confident", "calm"] },
  Gourmand: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["playful", "romantic", "calm"] },
  Aquatisch: { seasons: ["Sommer", "Frühling"], weather: ["sunny", "hot"], occasions: ["sport", "casual", "vacation"], times: ["morning", "afternoon"], moods: ["energetic", "playful", "calm"] },
  Süß: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["playful", "romantic"] },
  Würzig: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "date", "outdoor"], times: ["evening", "night"], moods: ["confident", "mysterious"] },
  Grün: { seasons: ["Frühling", "Sommer"], weather: ["sunny", "cloudy"], occasions: ["casual", "sport", "outdoor"], times: ["morning", "afternoon"], moods: ["calm", "energetic", "playful"] },
  Animalisch: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "date", "night"], times: ["evening", "night"], moods: ["confident", "mysterious", "romantic"] },
  Harzig: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "work"], times: ["afternoon", "evening"], moods: ["confident", "calm"] },
  Rauchig: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["evening", "date", "outdoor"], times: ["evening", "night"], moods: ["mysterious", "confident"] },
  Pudrig: { seasons: ["Ganzjährig"], weather: ["cloudy"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["romantic", "calm", "playful"] },
  Zitrisch: { seasons: ["Frühling", "Sommer"], weather: ["sunny", "hot"], occasions: ["sport", "casual", "outdoor"], times: ["morning", "afternoon"], moods: ["energetic", "playful", "calm"] },
  Erdig: { seasons: ["Herbst", "Winter"], weather: ["cold", "rainy"], occasions: ["work", "evening", "outdoor"], times: ["afternoon", "evening"], moods: ["confident", "calm", "mysterious"] },
  Cremig: { seasons: ["Herbst", "Winter"], weather: ["cold"], occasions: ["date", "casual", "evening"], times: ["afternoon", "evening"], moods: ["romantic", "calm", "playful"] },
  Fruchtig: { seasons: ["Sommer", "Frühling"], weather: ["sunny", "hot"], occasions: ["casual", "date", "vacation"], times: ["afternoon", "evening"], moods: ["playful", "energetic", "romantic"] },
  Synthetisch: { seasons: ["Ganzjährig"], weather: ["cloudy", "sunny"], occasions: ["casual", "work", "sport"], times: ["morning", "afternoon"], moods: ["confident", "energetic"] },
  Sonstiges: { seasons: ["Ganzjährig"], weather: ["cloudy"], occasions: ["casual"], times: ["afternoon"], moods: ["calm"] },
};

const MOODS = [
  { id: "energetic", label: "Energetisch", icon: "⚡", families: ["Fresh", "Aquatisch", "Gourmand"] },
  { id: "romantic", label: "Romantisch", icon: "♥", families: ["Floral", "Oriental", "Gourmand"] },
  { id: "confident", label: "Selbstsicher", icon: "★", families: ["Woody", "Chypre", "Oriental"] },
  { id: "calm", label: "Entspannt", icon: "◎", families: ["Aquatisch", "Fresh", "Floral"] },
  { id: "mysterious", label: "Geheimnisvoll", icon: "◆", families: ["Oriental", "Chypre", "Woody"] },
  { id: "playful", label: "Verspielt", icon: "◇", families: ["Gourmand", "Fresh", "Floral"] },
  { id: "sleep", label: "Schlafen", icon: "◑", families: ["Floral", "Fresh", "Gourmand"], isSleep: true },
];
const TIMES = [
  { id: "morning", label: "Morgens", families: ["Fresh", "Aquatisch", "Floral"] },
  { id: "afternoon", label: "Mittags", families: ["Fresh", "Chypre", "Woody"] },
  { id: "evening", label: "Abends", families: ["Oriental", "Woody", "Gourmand"] },
  { id: "night", label: "Nachts", families: ["Oriental", "Chypre", "Woody"] },
];
const WEATHERS = [
  { id: "sunny", label: "Sonnig", families: ["Fresh", "Aquatisch", "Floral"] },
  { id: "cloudy", label: "Bewölkt", families: ["Chypre", "Woody", "Fougère"] },
  { id: "rainy", label: "Regen", families: ["Oriental", "Woody", "Gourmand"] },
  { id: "cold", label: "Kalt", families: ["Oriental", "Gourmand", "Woody"] },
  { id: "hot", label: "Heiß", families: ["Fresh", "Aquatisch", "Floral"] },
];
const OCCASIONS = [
  { id: "casual", label: "Alltag", icon: "☀" },
  { id: "work", label: "Business", icon: "◈" },
  { id: "date", label: "Date", icon: "♥" },
  { id: "evening", label: "Abend", icon: "★" },
  { id: "sport", label: "Sport", icon: "◎" },
  { id: "special", label: "Special", icon: "◆" },
  { id: "outdoor", label: "Outdoor", icon: "◉" },
  { id: "travel", label: "Reise", icon: "→" },
  { id: "vacation", label: "Urlaub", icon: "✦" },
  { id: "sleep", label: "Schlafen", icon: "◑", isSleep: true },
];
const INTENSITIES = [
  { id: "light", label: "Leicht", note: "Subtil & nah" },
  { id: "medium", label: "Mittel", note: "Ausgewogen" },
  { id: "strong", label: "Stark", note: "Projizierend" },
];
const LONGEVITIES = [
  { id: "short", label: "2–4h", note: "Kurz" },
  { id: "medium", label: "4–8h", note: "Normal" },
  { id: "long", label: "8h+", note: "Langanhaltend" },
];
// ── Occasion → ideal families ────────────────────────────────────────────────

export {
  getSeason,
  FAMILY_CONTEXT,
  MOODS, TIMES, WEATHERS, OCCASIONS, INTENSITIES, LONGEVITIES,
};