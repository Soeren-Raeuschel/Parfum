/**
 * pickerConfig.js – Zentrale Konstanten für die "Parfum des Tages"-Auswahl.
 *
 * Alle Parameter des Pickers leben hier als Konstanten, damit sie später
 * an einer Stelle getunt werden können.
 */

export const PICKER_CONFIG = Object.freeze({
  // Düfte, die in den letzten X Tagen getragen wurden, sind ausgeschlossen
  cooldownDays: 14,

  // Stärke des Alterungs-/Rotationseffekts (höher = längere Pause wird stärker belohnt)
  agingStrength: 1.5,

  // Fiktive "Tage seit Tragen" für Düfte, die noch nie getragen wurden
  neverWornDays: 120,

  // Zufallsfaktor-Bereich (multiplikativ, damit kein Duft komplett abgeschnitten wird)
  randomMin: 0.85,
  randomMax: 1.15,

  // Fairness: Düfte, die länger als X Tage nicht "dran" waren, erhalten einen Bonus
  fairnessDays: 90,
  fairnessBonus: 1.5,

  // Fairness-Bonus gilt nur, wenn der Kriterien-Score mindestens diesem Wert entspricht
  fairnessMinCriteriaScore: 0.4,

  // ── Kriterien-Gewichte (Teil 2): Wetter/Anlass hoch, Tageszeit/Intensität
  // mittel, Stimmung/Haltbarkeit etwas niedriger ──
  criterionWeights: Object.freeze({
    occasion: 1.3,      // Anlass
    weather: 1.3,       // Wetter (inkl. Temperatur-Automatik)
    timeOfDay: 1.0,     // Tageszeit
    intensity: 1.0,     // Intensität
    mood: 0.8,          // Stimmung
    longevity: 0.8,     // Haltbarkeit
    season: 1.0,        // Saison (bestehende Logik)
    manualFamilies: 0.9,// manuell gesetzte Familien-Tags
  }),

  // Mischung des Kriterien-Scores: 0.55 × Familien-Score + 0.45 × Noten-Score
  SCORE_MIX: Object.freeze({ family: 0.55, notes: 0.45 }),

  // Noten-Zonen-Gewichtung: Basis 1.3×, Herz 1.0×, Kopf 0.7×
  NOTE_ZONE_WEIGHTS: Object.freeze({ top: 0.7, heart: 1.0, base: 1.3 }),

  // Familien-Positionsgewichtung: Hauptfamilie 1.0, zweite 0.6, dritte 0.35
  FAMILY_POSITION_WEIGHTS: Object.freeze([1.0, 0.6, 0.35]),

  // Evidenz-Faktoren (skalieren den Beitrag zum kriterienScore)
  EVIDENCE_FACTORS: Object.freeze({
    mood: 1.0,              // Stimmung/Entspannung (Lavendel, Bergamotte)
    occasionAndSeason: 0.7, // Anlass- und Jahreszeit-Zuordnungen
    attractiveness: 0.4,    // "Attraktivitäts-Noten" (Vetiver, Zitrus, Tabak …)
  }),

  // Bonus (+0.05) für Düfte mit hoher Passung in allen Wetterlagen
  // (nur bei Temperatur-Automatik, wenn keine Wetter-Chips gewählt sind)
  ALL_WEATHER_BONUS: 0.05,
  ALL_WEATHER_MIN_SCORE: 0.6,

  // Temperatur-Automatik: lineare Mischung zwischen 12 und 18 °C,
  // ab 25 °C zusätzliche Bevorzugung leichter/frischer Düfte
  TEMPERATURE_BLEND: Object.freeze({ low: 12, high: 18, hotFrom: 25 }),

  // Diversität: −10 % Score, wenn die Hauptfamilie in den letzten
  // 3 getragenen Düften schon vorkam (abschaltbar)
  diversityEnabled: true,
  diversityPenalty: 0.10,
  diversityWindow: 3,

  // Konzentrations-Modifikator: ±0.05 je Richtung (Netto-Unterschied ±0.1)
  concentrationModifier: 0.05,

  // ── Teil 3: "Heute"-Integration ──
  // Lernschleife: max. persönlicher Bonus/Malus pro Duft & Anlass
  // (auch in wearStore.js als FEEDBACK_BONUS_MAX gepflegt)
  feedbackBonusMax: 0.15,
  feedbackStep: 0.05,

  // Chip-Hilfe: Kriterien-Score ab dem ein Chip-Treffer zählt
  chipGoodThreshold: 0.55,
  // Chips mit <= so vielen Treffern werden gedimmt
  chipDimCount: 1,

  // Schrittweise Lockerung der Passungs-Schwelle, wenn nichts mehr passt
  relaxSteps: Object.freeze([0.55, 0.45, 0.0]),
  relaxMinCandidates: 1,

  // Wetter-Vorbelegung (Open-Meteo, kein API-Key): Standort Kassel
  autoWeatherCoords: Object.freeze({ lat: 51.3127, lon: 9.4797 }),
});