const { useState, useEffect, useMemo, useCallback, useRef, useReducer } = React;

    // ============================================================
    // ERROR HANDLING MODULE
    // Zentrale Fehlerklassen und strukturiertes Logging
    // ============================================================

    class AppError extends Error {
      constructor(message, code, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.type = code;
        this.fatal = false;
      }
    }

    class NetworkError extends AppError {
      constructor(message, details = {}) {
        super(message, 'NETWORK_ERROR', details);
      }
    }

    class RateLimitError extends AppError {
      constructor(message, details = {}) {
        super(message, 'RATE_LIMIT_ERROR', details);
      }
    }

    class ValidationError extends AppError {
      constructor(message, details = {}) {
        super(message, 'VALIDATION_ERROR', details);
      }
    }

    class ApiError extends AppError {
      constructor(message, details = {}) {
        super(message, 'API_ERROR', details);
      }
    }

    class InvalidResponseError extends AppError {
      constructor(message, details = {}) {
        super(message, 'INVALID_RESPONSE_ERROR', details);
      }
    }

    // Strukturiertes Logging
    function log(level, message, context = {}) {
      const timestamp = new Date().toISOString();
      console.log(`[${level}] ${message}`, { timestamp, level, message, context });
    }

    function handleApiError(error, context = {}) {
      if (error instanceof AppError) return error;
      if (error instanceof TypeError) return new NetworkError('Verbindungsfehler: Bitte prüfen Sie Ihre Internetverbindung.', { cause: error.message });
      if (error instanceof SyntaxError) return new NetworkError('Verbindungsfehler: Bitte prüfen Sie Ihre Internetverbindung.', { cause: error.message });
      return new NetworkError('Verbindungsfehler: Bitte versuchen Sie es später noch einmal.', { cause: error.message });
    }

    function handleValidationError(error, context = {}) {
      return error;
    }

    function handleNotFound(error, context = {}) {
      return new ApiError('Ressource nicht gefunden.', { resource: context?.resource });
    }

    function handleRateLimit(error, context = {}) {
      return new RateLimitError('API-Limit erreicht – bitte warten Sie einen Moment.', { retryAfter: error.details?.retryAfter });
    }

    function handleInvalidResponse(error, context = {}) {
      return new InvalidResponseError('Ungültige Antwort vom Server.', { details: error.details });
    }

    // ── Debounce helper ─────────────────────────────────────────────────────────────
    function debounce(fn, delay) {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
      };
    }

    // ── Storage keys ───────────────────────────────────────────────────────────────
    const KEYS = {
      items: "parfum_collection_v2",
      log: "parfum_log_v2",
      notes: "parfum_notes_v1",
      wishlist: "parfum_wishlist_v1",
      prefs: "parfum_prefs_v1",
      fillLevels: "parfum_fill_v1",
      onboarding: "parfum_onboard_v1",
      groqKey: "parfum_groq_key_v1",
      priceMl: "parfum_price_ml_v1",
      userNotePrefs: "parfum_user_note_prefs_v1",
      userFamilyPrefs: "parfum_user_family_prefs_v1",
      declutterStatus: "parfum_declutter_status_v1",
    };
    // Parfumo-Lookup: Groq-API (kostenlos: console.groq.com) – Key in Settings oder window.__SILLAGE_GROQ_KEY__

    // ── Design tokens ─────────────────────────────────────────────────────────────
    const SEASON_COLORS = {
      Frühling: { bg: "#E1F5EE", accent: "#0F6E56", text: "#085041" },
      Sommer: { bg: "#FAEEDA", accent: "#BA7517", text: "#633806" },
      Herbst: { bg: "#FAECE7", accent: "#993C1D", text: "#712B13" },
      Winter: { bg: "#E6F1FB", accent: "#185FA5", text: "#0C447C" },
      Ganzjährig: { bg: "#EEEDFE", accent: "#534AB7", text: "#3C3489" },
    };
    const FAM_COLORS = {
      Floral: "#D4537E", Woody: "#BA7517", Oriental: "#993C1D", Fresh: "#1D9E75",
      Chypre: "#185FA5", "Fougère": "#3B6D11", Gourmand: "#534AB7",
      Aquatisch: "#0F6E56", Sonstiges: "#5F5E5A",
      Süß: "#D4537E", Würzig: "#BA7517", Grün: "#5C6B4F", Animalisch: "#8B4513",
      Harzig: "#8B5E3C", Ledrig: "#7B4F3A", Rauchig: "#5F5E5A", Pudrig: "#C4A0B0", Zitrisch: "#C9A825",
      Erdig: "#6B5B3E", Cremig: "#E89B7A", Fruchtig: "#C2604A", Synthetisch: "#7F77DD",
    };
    const NOTE_TAGS = [
      { id: "eindruck", label: "Eindruck", color: "#534AB7" },
      { id: "anlass", label: "Anlass", color: "#0F6E56" },
      { id: "performance", label: "Performance", color: "#BA7517" },
      { id: "vergleich", label: "Vergleich", color: "#185FA5" },
      { id: "sonstiges", label: "Sonstiges", color: "#5F5E5A" },
    ];
    const WISH_PRIOS = [
      { id: 1, label: "Muss haben", color: "#993C1D" },
      { id: 2, label: "Interessant", color: "#BA7517" },
      { id: 3, label: "Irgendwann", color: "#5F5E5A" },
    ];

    // ── Season / color helpers ────────────────────────────────────────────────────
    function getSeasonColor(season) {
      if (!season) return SEASON_COLORS["Ganzjährig"];
      if (SEASON_COLORS[season]) return SEASON_COLORS[season];
      const key = Object.keys(SEASON_COLORS).find(k => season.includes(k));
      return SEASON_COLORS[key] || SEASON_COLORS["Ganzjährig"];
    }
    // NOTE: Season detection assumes northern hemisphere (März–Mai = Frühling etc.).
    // For southern hemisphere users, seasons would be inverted – not currently supported.
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

    const FAMILY_HARMONY = {
      Floral: ["Süß", "Pudrig", "Cremig", "Grün"],
      Woody: ["Harzig", "Animalisch", "Rauchig", "Erdig"],
      Oriental: ["Süß", "Würzig", "Harzig", "Animalisch"],
      Fresh: ["Zitrisch", "Aquatisch", "Grün", "Cremig"],
      Chypre: ["Woody", "Fougère", "Animalisch", "Grün"],
      "Fougère": ["Chypre", "Grün", "Harzig", "Cremig"],
      Gourmand: ["Süß", "Cremig", "Fruchtig", "Pudrig"],
      Aquatisch: ["Fresh", "Zitrisch", "Grün", "Cremig"],
      Süß: ["Gourmand", "Floral", "Cremig", "Pudrig"],
      Würzig: ["Oriental", "Harzig", "Rauchig", "Animalisch"],
      Grün: ["Fresh", "Aquatisch", "Zitrisch", "Chypre"],
      Animalisch: ["Oriental", "Woody", "Würzig", "Chypre"],
      Harzig: ["Woody", "Oriental", "Fougère", "Würzig"],
      Rauchig: ["Woody", "Oriental", "Würzig", "Animalisch"],
      Pudrig: ["Floral", "Süß", "Gourmand", "Cremig"],
      Zitrisch: ["Fresh", "Aquatisch", "Grün", "Fruchtig"],
      Erdig: ["Woody", "Chypre", "Harzig", "Rauchig"],
      Cremig: ["Gourmand", "Floral", "Süß", "Aquatisch"],
      Fruchtig: ["Gourmand", "Fresh", "Süß", "Zitrisch"],
      Synthetisch: ["Fresh", "Aquatisch", "Woody", "Oriental"],
    };

    const FAMILY_CONFLICT = {
      Aquatisch: ["Rauchig", "Animalisch", "Würzig"],
      Zitrisch: ["Animalisch", "Rauchig", "Harzig"],
      Süß: ["Animalisch", "Rauchig", "Zitrisch"],
      Fresh: ["Würzig", "Rauchig", "Animalisch"],
    };

    function getFamilyContextScore(family, ctx) {
      const fc = FAMILY_CONTEXT[family];
      if (!fc) return 0;
      let score = 0;
      if (fc.seasons?.includes(ctx.season)) score += 3;
      if (fc.weather?.includes(ctx.weather)) score += 3;
      if (fc.occasions?.includes(ctx.occasion)) score += 4;
      if (fc.times?.includes(ctx.timeOfDay)) score += 2;
      if (fc.moods?.includes(ctx.mood)) score += 3;
      return score;
    }

    function getFamilyHarmonyScore(perfumeFamilies, userFamilyPrefs) {
      if (!perfumeFamilies || perfumeFamilies.length === 0) return 0;
      if (!userFamilyPrefs || userFamilyPrefs.length === 0) return 0;
      let harmony = 0, conflict = 0;
      for (const pf of perfumeFamilies) {
        const good = FAMILY_HARMONY[pf] || [];
        const bad = FAMILY_CONFLICT[pf] || [];
        for (const uf of userFamilyPrefs) {
          if (good.includes(uf)) harmony += 3;
          if (bad.includes(uf)) conflict += 2;
        }
      }
      return Math.max(0, harmony - conflict);
    }

    function getMultiFamilyMatchScore(perfumeFamilies, userFamilyPrefs) {
      if (!perfumeFamilies || perfumeFamilies.length === 0) return 0;
      if (!userFamilyPrefs || userFamilyPrefs.length === 0) return 0;
      const matches = perfumeFamilies.filter(f => userFamilyPrefs.includes(f)).length;
      if (matches >= 3) return 20;
      if (matches === 2) return 12;
      if (matches === 1) return 5;
      return 0;
    }

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
    const OCC_FAM = {
      casual: { pri: ["Fresh", "Aquatisch", "Floral"], sec: ["Woody", "Chypre"] },
      work: { pri: ["Woody", "Chypre", "Fougère"], sec: ["Fresh", "Floral"] },
      date: { pri: ["Oriental", "Floral", "Gourmand"], sec: ["Woody", "Chypre"] },
      evening: { pri: ["Oriental", "Woody", "Gourmand"], sec: ["Chypre", "Floral"] },
      sport: { pri: ["Fresh", "Aquatisch"], sec: ["Floral", "Fougère"] },
      special: { pri: ["Oriental", "Chypre", "Floral"], sec: ["Woody", "Gourmand"] },
      outdoor: { pri: ["Fresh", "Aquatisch", "Chypre"], sec: ["Woody", "Floral"] },
      travel: { pri: ["Fresh", "Woody", "Oriental"], sec: ["Aquatisch", "Floral"] },
      vacation: { pri: ["Fresh", "Aquatisch", "Floral"], sec: ["Gourmand", "Oriental"] },
      sleep: { pri: ["Floral", "Fresh", "Aquatisch"], sec: ["Gourmand", "Woody"] },
    };

    // Concentration → perceived intensity (1–3) and longevity (1–3)
    const CONC_INT = { Parfum: 3, Extrait: 3, EDP: 2.5, EDT: 1.5, EDC: 1, Solid: 1 };
    const CONC_LON = { Parfum: 3, Extrait: 3, EDP: 2.5, EDT: 2, EDC: 1.5, Solid: 1 };

    // ── Duftpsychologie: Note → Wirkung (0–1 Stärke) ─────────────────────────────
    // Quellen: Aromatherapie-Forschung, Fragrance Psychology (Herz, 2009)
    const NOTE_PSYCHOLOGY = {
      // ENTSPANNEND / Beruhigend
      calm: {
        "lavendel": 1.0, "vanille": 0.95, "tonkabohne": 0.9, "sandelholz": 0.9,
        "vetiver": 0.85, "zedernholz": 0.8, "patschuli": 0.75, "weihrauch": 0.85,
        "myrrhe": 0.8, "benzoe": 0.8, "ylang-ylang": 0.75, "kamille": 1.0,
        "bergamotte": 0.7, "ambra": 0.7, "moschus": 0.65, "rose": 0.7,
        "iris": 0.65, "jasmin": 0.6, "labdanum": 0.75, "rum": 0.5,
        "holz": 0.6, "bourbon-vanille absolue": 0.95,
      },
      // ENERGETISIEREND / Belebend
      energetic: {
        "bergamotte": 0.9, "zitrone": 1.0, "grapefruit": 0.95, "limette": 0.9,
        "orange": 0.85, "mandarine": 0.8, "neroli": 0.75, "ingwer": 0.9,
        "pfeffer": 0.85, "rosa pfeffer": 0.8, "minze": 0.95, "eukalyptus": 0.9,
        "kardamom": 0.75, "petitgrain": 0.7, "kümmel": 0.7, "zitrusfrüchte": 0.9,
        "pomelo": 0.85, "yuzu": 0.85, "blutorange": 0.8,
      },
      // SINNLICH / Romantisch
      romantic: {
        "rose": 1.0, "jasmin": 0.95, "ylang-ylang": 0.9, "sandelholz": 0.85,
        "oud": 0.8, "ambra": 0.85, "vanille": 0.8, "moschus": 0.75,
        "patschuli": 0.7, "iris": 0.7, "safran": 0.8, "tonkabohne": 0.75,
        "labdanum": 0.8, "zimt": 0.7, "nelke": 0.65,
      },
      // SERIÖS / Selbstsicher
      confident: {
        "zedernholz": 1.0, "vetiver": 0.95, "sandelholz": 0.9, "eichenmoos": 0.85,
        "holz": 0.85, "leder": 0.9, "tabak": 0.8, "iris": 0.8, "patschuli": 0.75,
        "weihrauch": 0.75, "myrrhe": 0.7, "bergamotte": 0.65, "ambra": 0.6,
      },
      // VERSPIELT / Leicht
      playful: {
        "frucht": 0.85, "karamell": 0.9, "vanille": 0.8, "kokos": 0.85,
        "mandarine": 0.8, "orange": 0.75, "kirsche": 0.9, "beere": 0.85,
        "mango": 0.85, "ananas": 0.8, "himbeere": 0.85, "jasmin": 0.6,
        "maiglöckchen": 0.7, "veilchen": 0.75, "tonkabohne": 0.65,
      },
      // GEHEIMNISVOLL / Tiefgründig
      mysterious: {
        "oud": 1.0, "weihrauch": 0.95, "myrrhe": 0.9, "ambra": 0.85,
        "leder": 0.85, "tabak": 0.8, "patschuli": 0.8, "labdanum": 0.9,
        "safran": 0.85, "benzoe": 0.8, "zimt": 0.7, "nelke": 0.75,
        "rum": 0.7, "holz": 0.6, "vetiver": 0.75,
      },
      // SCHLAFEN / Nachtruhe
      // Quellen: Aromatherapie-Schlafforschung (Goel et al. 2005, Field et al. 2008)
      sleep: {
        // Stark schlaffördernd (klinisch belegt)
        "lavendel": 1.0, "kamille": 1.0, "baldrian": 0.95,
        // Beruhigend, entspannend
        "vanille": 0.9, "sandelholz": 0.88, "tonkabohne": 0.85, "benzoe": 0.85,
        "vetiver": 0.82, "moschus": 0.8, "ambra": 0.75, "ylang-ylang": 0.78,
        "weihrauch": 0.80, "patschuli": 0.70, "zedernholz": 0.72,
        // Mild blumig / frisch (nicht aufdringlich)
        "rose": 0.65, "neroli": 0.70, "jasmin": 0.60, "bergamotte": 0.65,
        "iris": 0.60, "veilchen": 0.65, "maiglöckchen": 0.55,
        // Leicht süß / warm
        "honig": 0.70, "litschi": 0.55, "bourbon-vanille absolue": 0.90,
        // Schlechte Schlafnoten (aufdringlich, aufweckend)
        "pfeffer": -0.3, "ingwer": -0.3, "minze": -0.4, "eukalyptus": -0.3,
        "zitrone": -0.2, "grapefruit": -0.2, "kardamom": -0.1,
        "oud": -0.1, "leder": -0.2, "tabak": -0.2, "rum": -0.2,
      },
    };

    // Score a perfume's notes against a psychology profile
    // Returns a value that can be negative (e.g. sleep-disrupting notes reduce the score).
    // Positive values: note supports the profile. Negative values: note works against it.
    // The raw sum is divided by allNotes.length so the scale stays comparable across
    // perfumes with different numbers of notes.
    function notePsychologyScore(perfume, profile) {
      const dict = NOTE_PSYCHOLOGY[profile] || {};
      const allNotes = [
        ...splitNotes(perfume.top),
        ...splitNotes(perfume.middle),
        ...splitNotes(perfume.base),
      ];
      if (!allNotes.length) return 0;
      let total = 0, anyHit = false;
      for (const note of allNotes) {
        const key = note.toLowerCase().trim();
        // Direct match or partial match – includes negative values (e.g. sleep: pfeffer: -0.3)
        const val = dict[key] ?? Object.entries(dict).find(([k]) => key.includes(k) || k.includes(key))?.[1] ?? 0;
        if (val !== 0) { total += val; anyHit = true; }
      }
      return anyHit ? total / allNotes.length : 0;
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // EMPFEHLUNGS-ENGINE v4
    // Score-Architektur:
    //   BASIS-SCORE        (0–50): Saison · Anlass · Wetter · Tageszeit
    //   KONTEXT-MULT       (×1.0–1.4): Kohärente Kombis verstärken
    //   PSYCHO-SCORE       (0–20): Note-Wirkung zur Stimmung
    //   HARMONY-BONUS      (0–10): Alle Parameter passen zusammen
    //   ROTATION-BONUS     (0–10): Lange nicht getragen → bevorzugen
    //   BEWERTUNGS-BONUS   (0–6):  Persönliche Qualität
    //   KONFLIKT-MALUS     (−10–0): Unlogische Kombis bestrafen
    //   RANDOMNESS         (0–3):  Tiebreaker / Wildcard-Variation
    // ══════════════════════════════════════════════════════════════════════════════

    // ── Konflikt-Definitionen ────────────────────────────────────────────────────
    // [occasion, intensityPref/family, Grund] → Malus
    const CONFLICTS = [
      // Sport + starke Projektion
      { check: (p, ctx) => ctx.occasion === "sport" && (CONC_INT[p.conc] || 2) > 2, malus: 10, reason: "Zu intensiv für Sport" },
      // Büro + Oud/Oriental
      { check: (p, ctx) => ctx.occasion === "work" && p.family === "Oriental" && (CONC_INT[p.conc] || 2) >= 2.5, malus: 8, reason: "Zu schwer für Büro" },
      // Morgens + schwere Orientalische
      { check: (p, ctx) => ctx.timeOfDay === "morning" && p.family === "Oriental" && (CONC_INT[p.conc] || 2) === 3, malus: 6, reason: "Zu intensiv für morgens" },
      // Heiß + Gourmand/Oriental EDP/Parfum
      { check: (p, ctx) => ctx.weather === "hot" && ["Oriental", "Gourmand"].includes(p.family) && (CONC_INT[p.conc] || 2) >= 2.5, malus: 7, reason: "Zu warm für heißes Wetter" },
      // Sport + Gourmand
      { check: (p, ctx) => ctx.occasion === "sport" && p.family === "Gourmand", malus: 6, reason: "Gourmand ungeeignet für Sport" },
      // Schlafen + starke Projektion (EDP/Parfum)
      { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && (CONC_INT[p.conc] || 2) >= 2.5, malus: 12, reason: "Zu intensiv zum Schlafen" },
      // Schlafen + Oriental stark (Oud etc.)
      { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && p.family === "Oriental" && (CONC_INT[p.conc] || 2) >= 2, malus: 8, reason: "Zu schwer für Schlafzimmer" },
    ];

    // ── Harmony-Kombis (Bonus wenn mehrere passen) ───────────────────────────────
    const HARMONY_COMBOS = [
      // Frisch + Sonnig + Sommer/Frühling
      { check: (p, ctx) => ["Fresh", "Aquatisch"].includes(p.family) && ["sunny", "hot"].includes(ctx.weather) && ["Sommer", "Frühling"].includes(ctx.season), bonus: 10 },
      // Oriental + Kalt + Abend
      { check: (p, ctx) => ["Oriental", "Woody"].includes(p.family) && ["cold", "rainy"].includes(ctx.weather) && ["evening", "night"].includes(ctx.timeOfDay), bonus: 10 },
      // Business + Chypre/Fougère + Mittel-Intensität
      { check: (p, ctx) => ctx.occasion === "work" && ["Chypre", "Fougère", "Woody"].includes(p.family) && ctx.intensityPref === "medium", bonus: 8 },
      // Date + Romantisch + Abend
      { check: (p, ctx) => ctx.occasion === "date" && ctx.mood === "romantic" && ["evening", "night"].includes(ctx.timeOfDay), bonus: 8 },
      // Sport + Fresh + Morgens
      { check: (p, ctx) => ctx.occasion === "sport" && ["Fresh", "Aquatisch"].includes(p.family) && ctx.timeOfDay === "morning", bonus: 9 },
      // Entspannt + Woody/Floral + Bewölkt
      { check: (p, ctx) => ctx.mood === "calm" && ["Woody", "Floral"].includes(p.family) && ctx.weather === "cloudy", bonus: 6 },
      // Outdoor + Chypre + Bewölkt/Kalt
      { check: (p, ctx) => ctx.occasion === "outdoor" && p.family === "Chypre" && ["cloudy", "cold"].includes(ctx.weather), bonus: 7 },
      // Gourmand + Winter + Abend
      { check: (p, ctx) => p.family === "Gourmand" && ctx.season === "Winter" && ["evening", "night"].includes(ctx.timeOfDay), bonus: 8 },
      // Schlafen + Lavendel/Vanille + leichte Konzentration
      { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && (CONC_INT[p.conc] || 2) <= 1.5, bonus: 12 },
      // Schlafen + Floral/Fresh + Nacht
      { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && ["Floral", "Fresh", "Aquatisch"].includes(p.family) && ctx.timeOfDay === "night", bonus: 8 },
      // Urlaub + Sommer + Fresh/Aquatisch/Gourmand
      { check: (p, ctx) => ctx.occasion === "vacation" && ctx.season === "Sommer" && ["Fresh", "Aquatisch", "Floral"].includes(p.family), bonus: 9 },
      // Urlaub + Oriental/Woody (abendlicher Urlaubs-Look)
      { check: (p, ctx) => ctx.occasion === "vacation" && ["evening", "night"].includes(ctx.timeOfDay) && ["Oriental", "Woody", "Gourmand"].includes(p.family), bonus: 7 },
    ];

    // ── Kontext-Multiplikatoren ──────────────────────────────────────────────────
    const CONTEXT_MULTIPLIERS = [
      { check: (p, ctx) => ctx.occasion === "work" && (CONC_INT[p.conc] || 2) <= 1.5, mult: 1.35, label: "Subtil – ideal im Büro" },
      { check: (p, ctx) => ctx.occasion === "date" && ctx.mood === "romantic" && ["Oriental", "Floral"].includes(p.family), mult: 1.35, label: "Romantisch · sinnlich" },
      { check: (p, ctx) => ctx.occasion === "sport" && (CONC_INT[p.conc] || 2) <= 1.5 && ["Fresh", "Aquatisch"].includes(p.family), mult: 1.4, label: "Frisch & leicht – perfekt für Sport" },
      { check: (p, ctx) => ctx.occasion === "special" && (p.rating || 0) >= 4, mult: 1.3, label: "Bewährt für besondere Anlässe" },
      { check: (p, ctx) => ctx.occasion === "evening" && (CONC_INT[p.conc] || 2) >= 2.5, mult: 1.25, label: "Starke Projektion für den Abend" },
      { check: (p, ctx) => (ctx.mood === "sleep" || ctx.occasion === "sleep") && (CONC_INT[p.conc] || 2) <= 1.5 && ["Floral", "Fresh"].includes(p.family), mult: 1.4, label: "Sanft & beruhigend – ideal zum Einschlafen" },
      { check: (p, ctx) => ctx.occasion === "vacation" && (p.rating || 0) >= 4, mult: 1.2, label: "Bewährter Urlaubs-Duft" },
    ];

    // ── Rotation-Logik ───────────────────────────────────────────────────────────
    function rotationBonus(p, log) {
      const wears = log.filter(l => l.id === p.id);
      if (wears.length === 0) return 8; // noch nie getragen → stark bevorzugen
      const lastWorn = Math.max(...wears.map(l => l.ts));
      const daysSince = (Date.now() - lastWorn) / 86400000;
      if (daysSince > 30) return 10;   // >30 Tage → max Bonus
      if (daysSince > 14) return 7;
      if (daysSince > 7) return 4;
      if (daysSince > 3) return 1;
      return 0;                         // < 3 Tage → kein Bonus
    }

    // ── Wiederholungs-Malus (letzte 3 Tage getragen → stark bestrafen) ───────────
    function recencyMalus(p, log) {
      const recent = log.filter(l => l.id === p.id && (Date.now() - l.ts) < 3 * 86400000);
      return recent.length * 8; // -8 pro Trag in den letzten 3 Tagen
    }

    // ── Begründungs-Generator ────────────────────────────────────────────────────
    function buildReason(p, ctx, role, log) {
      const parts = [];
      const fam = p.family || "Sonstiges";

      // Rolle
      if (role === "top1") parts.push("Bestes Match heute");
      else if (role === "top2") parts.push("Starke Alternative");
      else if (role === "top3") parts.push("Sehr gut geeignet");
      else if (role === "alt1") parts.push("Gute Option");
      else if (role === "alt2") parts.push("Solide Wahl");
      else if (role === "wildcard") parts.push("Überraschungsvorschlag");

      // Kontext-Match
      const occ = OCC_FAM[ctx.occasion];
      if (occ?.pri.includes(fam)) parts.push(`${fam} passt ideal zum Anlass`);
      else if (occ?.sec.includes(fam)) parts.push(`${fam} funktioniert gut hier`);

      // Wetter
      const wx = WEATHERS.find(w => w.id === ctx.weather);
      if (wx?.families.includes(fam)) {
        // Build grammatically correct German: "sonnigem", "bewölktem", "regnerischem", etc.
        const weatherAdj = { sunny: "sonnigem", cloudy: "bewölktem", rainy: "regnerischem", cold: "kaltem", hot: "heißem" };
        const adj = weatherAdj[ctx.weather] || wx.label.toLowerCase() + "em";
        parts.push(`Harmoniert mit ${adj} Wetter`);
      }

      // Stimmung / Psychologie
      const moodToProfile = { calm: "calm", energetic: "energetic", romantic: "romantic", confident: "confident", playful: "playful", mysterious: "mysterious", sleep: "sleep" };
      const profile = moodToProfile[ctx.mood];
      const psychVal = notePsychologyScore(p, profile);
      if (psychVal > 0.5) {
        const moodLabel = MOODS.find(m => m.id === ctx.mood)?.label || ctx.mood;
        parts.push(`Duftnoten wirken ${moodLabel.toLowerCase()}`);
      }

      // Rotation
      const wears = log.filter(l => l.id === p.id);
      if (wears.length === 0) parts.push("Noch nie getragen – ideale Gelegenheit");
      else {
        const daysSince = (Date.now() - Math.max(...wears.map(l => l.ts))) / 86400000;
        if (daysSince > 14) parts.push(`Zuletzt vor ${Math.round(daysSince)} Tagen`);
      }

      // Bewertung
      if ((p.rating || 0) >= 4) parts.push(`Du hast es mit ${p.rating}★ bewertet`);

      // Wildcard-Hinweis
      if (role === "wildcard") parts.push("Probier mal etwas anderes!");

      return parts.slice(0, 3).join(" · ");
    }

    // ── HAUPT-SCORING-FUNKTION ───────────────────────────────────────────────────
    function score(p, ctx) {
      const { season, weather, occasion, mood, timeOfDay, intensityPref, longevityPref, log, userNotePrefs, userFamilyPrefs } = ctx;
      const fam = p.family || "Sonstiges";
      const ps = (p.season || "").toLowerCase();
      let s = 0;

      // ── BASIS-SCORE (0–50) ───────────────────────────────────────────────────
      // Saison (0–15)
      if (ps.includes(season.toLowerCase())) s += 15;
      else if (ps.includes("ganzjährig")) s += 11;
      else s += 2;

      // Anlass (0–14)
      const occ = OCC_FAM[occasion] || { pri: [], sec: [] };
      if (occ.pri.includes(fam)) s += 14;
      else if (occ.sec.includes(fam)) s += 7;

      // Wetter (0–10)
      const wx = WEATHERS.find(w => w.id === weather);
      if (wx?.families.includes(fam)) s += 10;

      // Tageszeit (0–6)
      const tx = TIMES.find(t => t.id === timeOfDay);
      if (tx?.families.includes(fam)) s += 6;

      // Intensität (0–5)
      const ci = CONC_INT[p.conc] || 2;
      const ip = intensityPref === "light" ? 1 : intensityPref === "strong" ? 3 : 2;
      s += Math.max(0, 5 - Math.abs(ci - ip) * 2);

      // ── BENUTZER-PRÄFERENZEN (Duftnoten & Familien) ───────────────────────────
      // Get perfume families (from array or fallback to single family)
      const perfumeFamilies = (p.families && p.families.length > 0) ? p.families : [fam];
      const mainFamily = perfumeFamilies[0] || "Sonstiges";

      // #8: Prioritäts-Gewichtung der Duftfamilien
      // Position 0 (Hauptfamilie) = volle Gewichtung
      // Position 1 (2. Familie)   = halbe Gewichtung
      // Position 2 (3. Familie)   = Viertel-Gewichtung
      const FAMILY_PRIORITY_WEIGHTS = [1.0, 0.5, 0.25];

      // Main family match (primary family gets extra weight) (0-15)
      if (userFamilyPrefs && userFamilyPrefs.length > 0) {
        perfumeFamilies.forEach((f, idx) => {
          if (userFamilyPrefs.includes(f)) {
            const w = FAMILY_PRIORITY_WEIGHTS[idx] ?? 0.1;
            s += Math.round(15 * w);
          }
        });
      }

      // Multi-family match score (0-20) - additional families beyond main
      const multiFamilyScore = getMultiFamilyMatchScore(perfumeFamilies, userFamilyPrefs);
      s += multiFamilyScore;

      // Family context score for each family – weighted by position (#8)
      let weightedContextScore = 0;
      for (let idx = 0; idx < perfumeFamilies.length; idx++) {
        const f = perfumeFamilies[idx];
        const w = FAMILY_PRIORITY_WEIGHTS[idx] ?? 0.1;
        const cs = getFamilyContextScore(f, { season, weather, occasion, timeOfDay, mood });
        weightedContextScore += cs * w;
      }
      s += Math.min(15, Math.round(weightedContextScore));

      // Family harmony score (can be negative)
      const harmonyScore = getFamilyHarmonyScore(perfumeFamilies, userFamilyPrefs);
      s += harmonyScore;

      // Noten-Präferenz (0–25)
      // userNotePrefs ist jetzt ein Array von NOTE_CATEGORIES
      if (userNotePrefs && userNotePrefs.length > 0) {
        const perfumeNotes = [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
          .map(n => n.toLowerCase().trim());

        let noteMatchScore = 0;

        // Check each perfume note against user's selected categories
        for (const note of perfumeNotes) {
          const cat = NOTE_TO_CAT[note];
          if (cat && userNotePrefs.includes(cat)) {
            noteMatchScore += 2;
          }
        }

        s += Math.min(25, noteMatchScore);
      }

      // ── KONTEXT-MULTIPLIKATOR (×1.0–1.4) ────────────────────────────────────
      let mult = 1.0;
      for (const cm of CONTEXT_MULTIPLIERS) {
        if (cm.check(p, ctx)) { mult = Math.max(mult, cm.mult); break; }
      }
      s = Math.round(s * mult);

      // ── DUFTPSYCHOLOGIE (−20–+20) ────────────────────────────────────────────
      // Positive: note supports the mood. Negative: note works against it (e.g. stimulating
      // notes for sleep mode). notePsychologyScore() now returns values in that signed range.
      const moodToProfile = { calm: "calm", energetic: "energetic", romantic: "romantic", confident: "confident", playful: "playful", mysterious: "mysterious", sleep: "sleep" };
      const profile = moodToProfile[mood] || mood;
      const psychVal = notePsychologyScore(p, profile);
      s += Math.round(psychVal * 20);
      // Fallback: no note data at all (psychVal === 0 AND no notes exist) → use family as proxy
      if (psychVal === 0) {
        const mx = MOODS.find(m => m.id === mood);
        if (mx?.families.includes(fam)) s += 8;
      }

      // ── HARMONY-BONUS (0–10) ────────────────────────────────────────────────
      for (const hc of HARMONY_COMBOS) {
        if (hc.check(p, ctx)) { s += hc.bonus; break; }
      }

      // ── ROTATION-BONUS (0–10) ───────────────────────────────────────────────
      s += rotationBonus(p, log);

      // ── BEWERTUNGS-BONUS (0–6) ──────────────────────────────────────────────
      s += (p.rating || 0) * 1.2;

      // ── HALTBARKEIT-MATCH (0–4) ─────────────────────────────────────────────
      const cl = CONC_LON[p.conc] || 2;
      const lp = longevityPref === "short" ? 1 : longevityPref === "long" ? 3 : 2;
      s += Math.max(0, 4 - Math.abs(cl - lp) * 1.5);

      // ── KONFLIKT-MALUS (−10–0) ──────────────────────────────────────────────
      for (const cf of CONFLICTS) {
        if (cf.check(p, ctx)) { s -= cf.malus; break; }
      }

      // ── WIEDERHOLUNGS-MALUS ──────────────────────────────────────────────────
      s -= recencyMalus(p, log);

      // ── CONTROLLED RANDOMNESS (0–3) ─────────────────────────────────────────
      // Seed basiert auf Tageszeit + Parfum-ID → gleiche Regler, verschiedene Tages-Sessions = andere Reihenfolge
      const daySlot = Math.floor(Date.now() / (4 * 3600000)); // wechselt alle 4h
      const idHash = p.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const seededRandom = ((daySlot * 2654435761 + idHash * 40503) >>> 0) / 4294967296;
      s += seededRandom * 3;

      return Math.round(Math.max(0, s));
    }

    // ── Empfehlungs-Engine: erzeugt Top3 + 2 Alt + 1 Wildcard ───────────────────
    function generateRecommendations(items, ctx) {
      if (!items.length) return null;

      // ── Optionale Vorfilter (Frage 2: skalierbare KI-Parameter) ─────────────────
      let pool = items;
      // Gender-Filter
      if (ctx.genderPref) {
        const gf = ctx.genderPref.toLowerCase();
        const filtered = pool.filter(p => (p.gender || "").toLowerCase().includes(gf) || (p.gender || "").toLowerCase() === "unisex");
        if (filtered.length >= 3) pool = filtered; // nur anwenden wenn genug Ergebnisse
      }
      // Preisbereich-Filter: nutzt priceMl wenn vorhanden (wird via ctx übergeben wenn verfügbar)
      // Für Empfehlungsmotor: kein harter Filter, sondern Bonus-Punkte via Score
      // (Harter Filter würde bei kleinen Sammlungen zu keinem Ergebnis führen)

      const scored = pool
        .map(p => {
          let s = score(p, ctx);
          // Preis-Bonus wenn priceMl-Daten vorhanden (ctx.priceMl optional)
          if (ctx.priceRange && ctx.priceMl) {
            const pm = ctx.priceMl[p.id];
            if (pm) {
              const pricePerMl = pm.price / pm.ml;
              const isLuxury = pricePerMl > 1.5;
              const isBudget = pricePerMl < 0.4;
              if (ctx.priceRange === "luxury" && isLuxury) s += 8;
              if (ctx.priceRange === "budget" && isBudget) s += 8;
              if (ctx.priceRange === "mid" && !isLuxury && !isBudget) s += 6;
            }
          }
          return { ...p, _s: s };
        })
        .sort((a, b) => b._s - a._s);

      const top3 = scored.slice(0, 3);
      const rest = scored.slice(3);

      // Alternativen: aus einer anderen Duftfamilie als Top1
      const top1Fam = top3[0]?.family;
      const alts = rest.filter(p => p.family !== top1Fam).slice(0, 2);

      // Wildcard: zufällig aus Bottom-40% – andere Familie als Top1
      const bottomSlice = scored.slice(Math.floor(scored.length * 0.6));
      const wildcandidates = bottomSlice.filter(p => p.family !== top1Fam);
      const wildcard = wildcandidates.length
        ? wildcandidates[Math.floor(Math.random() * Math.min(wildcandidates.length, 20))]
        : bottomSlice[Math.floor(Math.random() * Math.min(bottomSlice.length, 10))];

      return {
        top3,
        alts: alts.length >= 2 ? alts : rest.slice(0, 2), // Fallback
        wildcard,
        roles: {
          [top3[0]?.id]: "top1", [top3[1]?.id]: "top2", [top3[2]?.id]: "top3",
          [alts[0]?.id]: "alt1", [alts[1]?.id]: "alt2", [wildcard?.id]: "wildcard"
        },
      };
    }

    function splitNotes(val) {
      if (!val) return [];
      return val.replace(/\s*·\s*/g, ",").split(",").map(n => n.trim()).filter(Boolean);
    }
    function sanitizeField(v) {
      return (v == null ? "" : String(v)).replace(/[\t\r\n]/g, " ").trim();
    }
    const MAX_TSV_CHARS = 2_000_000;
    const MAX_TSV_LINES = 50_000;
    const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
    const MAX_RENDERED_RESULTS = 180;
    const FAMILIES = ["Floral", "Woody", "Oriental", "Fresh", "Chypre", "Fougère", "Gourmand", "Aquatisch", "Süß", "Würzig", "Grün", "Animalisch", "Harzig", "Ledrig", "Rauchig", "Pudrig", "Zitrisch", "Erdig", "Cremig", "Fruchtig", "Synthetisch", "Sonstiges"];
    const SEASONS = ["Frühling", "Sommer", "Herbst", "Winter", "Ganzjährig"];
    const NOTE_CATEGORIES = ["Süß", "Würzig", "Grün", "Animalisch", "Harzig", "Synthetisch", "Rauchig", "Fougère", "Aquatisch", "Pudrig", "Zitrisch", "Erdig", "Cremig", "Fruchtig"];
    const NOTE_CAT_COLORS = {
      Süß: "#D4537E", Würzig: "#BA7517", Grün: "#5C6B4F", Animalisch: "#8B4513",
      Harzig: "#8B5E3C", Synthetisch: "#7F77DD", Rauchig: "#5F5E5A", Fougère: "#3B6D11",
      Aquatisch: "#2E86AB", Pudrig: "#C4A0B0", Zitrisch: "#C9A825", Erdig: "#6B5B3E",
      Cremig: "#E89B7A", Fruchtig: "#C2604A",
    };
    const NOTE_TO_CAT = {
      // Süß
      vanille: "Süß", honig: "Süß", karamell: "Süß", zucker: "Süß", praline: "Süß", schokolade: "Süß",
      marshmallow: "Süß", bonbon: "Süß", "cotton candy": "Süß", tonka: "Süß",
      // heliotrop → Pudrig (powdery is its dominant character; removed duplicate Süß entry)
      // Würzig
      zimt: "Würzig", pfeffer: "Würzig", muskat: "Würzig", ingwer: "Würzig", nelke: "Würzig",
      safran: "Würzig", kardamom: "Würzig", kumin: "Würzig", sternanis: "Würzig", kurkuma: "Würzig",
      // Grün
      gras: "Grün", tee: "Grün", bambus: "Grün", moos: "Grün", blätter: "Grün",
      fleur: "Grün", "grüner tee": "Grün", galbanum: "Grün",
      // eichenmoos → Fougère (canonical home; removed duplicate Grün entry)
      // vetiver → Erdig (dominant character; removed duplicate Grün/Rauchig entries)
      // Animalisch
      moschus: "Animalisch", amber: "Animalisch", civette: "Animalisch", castoreum: "Animalisch",
      leder: "Animalisch", seide: "Animalisch",
      // oud → Rauchig (oud is better placed here as its smokiness is its most distinctive trait;
      //                  removed duplicate Animalisch entry)
      // Harzig
      weihrauch: "Harzig", myrrhe: "Harzig", benzoe: "Harzig", labdanum: "Harzig", opoponax: "Harzig",
      elemi: "Harzig", copaiba: "Harzig",
      // Synthetisch
      "iso e": "Synthetisch", ambroxan: "Synthetisch", hedione: "Synthetisch",
      etalon: "Synthetisch", geosmin: "Synthetisch",
      // cashmeran → Cremig (warm, creamy character; removed duplicate Synthetisch entry)
      // calone → Aquatisch (marine molecule; removed duplicate Synthetisch entry)
      // Rauchig
      tabak: "Rauchig", rauch: "Rauchig", oud: "Rauchig", birke: "Rauchig", guaiac: "Rauchig",
      incense: "Rauchig",
      // Fougère
      lavendel: "Fougère", coumarin: "Fougère", geranie: "Fougère", eichenmoos: "Fougère",
      salbei: "Fougère", thymian: "Fougère",
      // Aquatisch
      meer: "Aquatisch", ozean: "Aquatisch", wasser: "Aquatisch", alge: "Aquatisch", salz: "Aquatisch",
      regen: "Aquatisch", calone: "Aquatisch", lotus: "Aquatisch",
      // Pudrig
      iris: "Pudrig", puder: "Pudrig", veilchen: "Pudrig", heliotrop: "Pudrig", lippenstift: "Pudrig",
      kosmetisch: "Pudrig", mimose: "Pudrig",
      // Zitrisch
      zitrone: "Zitrisch", bergamotte: "Zitrisch", orange: "Zitrisch", limette: "Zitrisch",
      grapefruit: "Zitrisch", mandarine: "Zitrisch", neroli: "Zitrisch", petitgrain: "Zitrisch",
      yuzu: "Zitrisch", kumquat: "Zitrisch",
      // Erdig
      patchouli: "Erdig", erdig: "Erdig", trüffel: "Erdig", humus: "Erdig", khol: "Erdig",
      zypriol: "Erdig", vetiver: "Erdig",
      // Cremig
      milch: "Cremig", sandelholz: "Cremig", sahne: "Cremig", kokos: "Cremig", butter: "Cremig",
      mandelmilch: "Cremig", cashmeran: "Cremig",
      // Fruchtig
      birne: "Fruchtig", apfel: "Fruchtig", pfirsich: "Fruchtig", mango: "Fruchtig",
      himbeere: "Fruchtig", erdbeere: "Fruchtig", ananas: "Fruchtig", lychee: "Fruchtig",
      passe: "Fruchtig", cassis: "Fruchtig", stachelbeere: "Fruchtig", quitte: "Fruchtig",
    };
    function suggestNoteCategories(top, middle, base) {
      const allNotes = [...splitNotes(top), ...splitNotes(middle), ...splitNotes(base)];
      const scores = {};
      allNotes.forEach(note => {
        const key = normalizeText(note);
        const cat = NOTE_TO_CAT[key];
        if (cat) scores[cat] = (scores[cat] || 0) + 1;
      });
      return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
    }
    function stripDiacritics(s) {
      return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    function normalizeText(s) {
      return stripDiacritics(String(s || "")).toLowerCase().trim();
    }
    function tokenizeText(s) {
      return normalizeText(s).split(/[^a-z0-9äöüß]+/).filter(Boolean);
    }
    // ── Enhanced debouncing with AbortController ──────────────────────────────────
    function useDebounce(value, delay = 300) {
      const [debounced, setDebounced] = useState(value);
      const timeoutRef = useRef(null);
      const abortControllerRef = useRef(null);
      
      useEffect(() => {
        // Clear previous timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        
        // Abort previous async operation (if any)
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        
        // Create new AbortController for this cycle
        abortControllerRef.current = new AbortController();
        
        // Set new timeout
        timeoutRef.current = setTimeout(() => {
          setDebounced(value);
        }, delay);
        
        // Cleanup on unmount or before next effect run
        return () => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
      }, [value, delay]);
      
      // Return the debounced value, abort signal and an abort function for external use
      return { 
        debounced, 
        signal: abortControllerRef.current?.signal,
        abort: () => {
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }
        }
      };
    }
    // ──────────────────────────────────────────────────────────────────────────────
    function sanitizePerfume(item) {
      const src = item && typeof item === "object" ? item : {};
      const cleanStr = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
      const famRaw = cleanStr(src.family, 80);
      const seasonRaw = cleanStr(src.season, 80);
      const fam = FAMILIES.includes(famRaw) ? famRaw : "Sonstiges";
      const season = SEASONS.some(s => seasonRaw.includes(s)) ? seasonRaw : "Ganzjährig";
      const ratingNum = Number.parseInt(src.rating, 10);

      // Handle families array - keep first family as family for compatibility, store all in families
      let families = [];
      if (Array.isArray(src.families)) {
        families = src.families.filter(f => FAMILIES.includes(f));
      }
      if (families.length === 0 && fam && fam !== "Sonstiges") {
        families = [fam];
      }

      return {
        id: cleanStr(src.id, 80) || newId(),
        name: cleanStr(src.name, 220),
        house: cleanStr(src.house, 180),
        conc: cleanStr(src.conc, 40),
        family: families.length > 0 ? families[0] : "Sonstiges",
        families: families,
        top: cleanStr(src.top, 2000),
        middle: cleanStr(src.middle, 2000),
        base: cleanStr(src.base, 2000),
        season,
        gender: cleanStr(src.gender, 40) || "Unisex",
        format: cleanStr(src.format, 20) || "Probe",
        url: cleanStr(src.url, 2048),
        spotify_url: cleanStr(src.spotify_url, 2048),
        rating: Number.isFinite(ratingNum) ? Math.min(5, Math.max(0, ratingNum)) : 0,
        note_categories: Array.isArray(src.note_categories) ? src.note_categories.filter(c => NOTE_CATEGORIES.includes(c)).slice(0, 3) : [],
        addedAt: typeof src.addedAt === "number" ? src.addedAt : (src.addedAt ? new Date(src.addedAt).getTime() : Date.now()),
      };
    }
    function safeParseJSON(raw, fallback) {
      if (raw == null || raw === "") return fallback;
      try { return JSON.parse(raw); } catch { return fallback; }
    }
    function hydrateArray(raw, fallback) {
      const v = safeParseJSON(raw, fallback);
      return Array.isArray(v) ? v : fallback;
    }
    function hydrateObject(raw, fallback) {
      const v = safeParseJSON(raw, fallback);
      return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
    }
    function hydrateItems(raw) {
      return hydrateArray(raw, [])
        .filter(x => x && typeof x === "object")
        .map(sanitizePerfume)
        .filter(x => x.name);
    }
    function hydrateLog(raw) {
      return hydrateArray(raw, []).filter(x => x && typeof x === "object" && typeof x.ts === "number").slice(-1000);
    }
    function hydrateWishlist(raw) {
      return hydrateArray(raw, []).filter(x => x && typeof x === "object" && typeof x.name === "string");
    }
    function hydrateNotes(raw) {
      const o = safeParseJSON(raw, null);
      if (!o || typeof o !== "object" || Array.isArray(o)) return {};
      const out = {};
      for (const k of Object.keys(o)) {
        if (k === "__proto__" || k === "constructor" || k.length > 200) continue;
        out[k] = o[k];
      }
      return out;
    }
    function hydrateFillLevels(raw) {
      const o = hydrateObject(raw, {});
      const out = {};
      for (const [k, v] of Object.entries(o)) {
        if (typeof k === "string" && k.length < 200 && typeof v === "number" && [100, 75, 50, 25, 0].includes(v)) out[k] = v;
      }
      return out;
    }
    function hydratePriceMl(raw) {
      const o = hydrateObject(raw, {});
      const out = {};
      for (const [k, v] of Object.entries(o)) {
        if (typeof k === "string" && k.length < 200 && v && typeof v === "object") {
          const price = Number(v.price);
          const ml = Number(v.ml);
          if (Number.isFinite(price) && price >= 0 && Number.isFinite(ml) && ml > 0) {
            out[k] = { price, ml };
          }
        }
      }
      return out;
    }
    function hydratePrefs(raw) {
      const o = hydrateObject(raw, { appName: "Sillage" });
      const name = typeof o.appName === "string" ? o.appName.slice(0, 80) : "Sillage";
      return { ...o, appName: name || "Sillage" };
    }
    function newId() {
      try {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
      } catch { }
      return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
    }
    function validateParfumoLookupUrl(raw) {
      const s = String(raw || "").trim();
      if (!s || s.length > 2048) throw new Error("Ungültige oder zu lange URL");
      let u;
      try { u = new URL(s.startsWith("http") ? s : "https://" + s); } catch { throw new Error("Ungültige URL"); }
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Nur http(s)-URLs erlaubt");
      const host = u.hostname.toLowerCase();
      if (host !== "parfumo.de" && !host.endsWith(".parfumo.de")) throw new Error("Nur parfumo.de-Links werden unterstützt");
      return u.href;
    }
    function getGroqKey() {
      try {
        const stored = typeof localStorage !== "undefined" && localStorage.getItem(KEYS.groqKey);
        if (typeof stored === "string" && stored.trim().length >= 10) return stored.trim();
      } catch { }
      const w = typeof window !== "undefined" ? window : {};
      const k = w.__SILLAGE_GROQ_KEY__ || w.__SILLAGE_AI_KEY__;
      return typeof k === "string" && k.length >= 10 ? k.trim() : null;
    }
    const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
    const LOOKUP_PAGE_MAX_CHARS = 6000; // Reduziert von 10000 → weniger Input-Tokens

        // ══════════════════════════════════════════════════════════════════════════════
    // REGEX SAFETY & ReDoS PROTECTION v2
    // Prevents catastrophic backtracking (ReDoS) by:
    //  - Capping input length before regex processing
    //  - Checking patterns for known dangerous constructions
    //  - Timeout-based execution fallback
    //  - Sanitizing dynamic pattern construction
    // ══════════════════════════════════════════════════════════════════════════════

    const DANGEROUS_REGEX_PATTERNS = [
      /\([^()]*\+\)[^()]*\+/,      // (a+)+ pattern
      /\([^|]*\|[^|]*\+\)[^|]*\+/, // (a|a+)+ pattern
      /\[[^\[\]]*\+\[^\[\]]\+/,     // nested [...]+...
    ];

    function isRegexDangerous(pattern) {
      if (!pattern || typeof pattern !== 'string') return false;
      return DANGEROUS_REGEX_PATTERNS.some(p => p.test(pattern));
    }

    function safeRegexMatch(str, pattern, flags = '', maxInputLen = 5000, timeoutMs = 100) {
      if (!str || typeof str !== 'string') return null;
      if (str.length > maxInputLen) return null;
      if (isRegexDangerous(pattern)) return null;
      try {
        const start = Date.now();
        const result = str.match(new RegExp(pattern, flags));
        const elapsed = Date.now() - start;
        if (elapsed > timeoutMs) {
          // Slow execution – could log, but silently return for now
        }
        return result ? result : null;
      } catch (e) {
        return null;
      }
    }

    function safeExtractBlock(html, blockClass, maxLen = 5000) {
      if (!html || typeof html !== 'string') return '';
      if (html.length > maxLen) return '';
      const safeClass = blockClass.replace(/[^\w-]/g, '');
      if (!safeClass) return '';
      const pattern = '<div[^>]+class="[^"]*' + safeClass + '[^"]*"[^>]*>([\\s\\S]*?)</div>\\s*</div>\\s*</div>';
      if (isRegexDangerous(pattern)) return '';
      const re = new RegExp(pattern, 'i');
      const match = html.match(re);
      return match ? match[1] : '';
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // JSON SCHEMA VALIDATION & RETRY LOGIC
    // Validates Groq API responses against expected schemas
    // Automatic retry with stricter prompt on schema violation
    // ══════════════════════════════════════════════════════════════════════════════

    // Schema definitions for expected JSON responses
    const JSON_SCHEMAS = {
      lookup: {
        requiredKeys: ['name', 'house', 'conc', 'family', 'top', 'middle', 'base', 'season', 'gender'],
        keyTypes: { name: 'string', house: 'string', conc: 'string', family: 'string', top: 'string', middle: 'string', base: 'string', season: 'string', gender: 'string' },
        enumConstraints: { conc: ['EDP', 'EDT', 'Parfum', 'EDC', 'Extrait'], family: ['Floral', 'Woody', 'Oriental', 'Fresh', 'Chypre', 'Fougère', 'Gourmand', 'Aquatisch', 'Sonstiges'], season: ['Frühling', 'Sommer', 'Herbst', 'Winter', 'Ganzjährig'], gender: ['Unisex', 'Feminin', 'Maskulin'] }
      },
      dayParams: {
        requiredKeys: ['occasion', 'mood', 'timeOfDay', 'intensityPref', 'longevityPref', 'reasoning'],
        keyTypes: { occasion: 'string', mood: 'string', timeOfDay: 'string', intensityPref: 'string', longevityPref: 'string', reasoning: 'string' },
        enumConstraints: { occasion: ['casual', 'work', 'sport', 'evening', 'date', 'sleep', 'special', 'outdoor', 'travel', 'vacation'], mood: ['energetic', 'calm', 'romantic', 'confident', 'mysterious', 'playful', 'sleep'], timeOfDay: ['morning', 'afternoon', 'evening', 'night'], intensityPref: ['light', 'medium', 'strong'], longevityPref: ['short', 'medium', 'long'] },
        maxLengths: { reasoning: 80 }
      }
    };

    // Validates a parsed JSON object against a schema definition
    function validateJsonSchema(obj, schemaName) {
      const schema = JSON_SCHEMAS[schemaName];
      if (!schema) return { valid: false, errors: [`Unknown schema: ${schemaName}`] };
      if (!obj || typeof obj !== 'object') return { valid: false, errors: ['Response is not an object'] };
      const errors = [];
      for (const key of schema.requiredKeys) {
        if (!(key in obj)) { errors.push(`Missing required key: ${key}`); continue; }
        const val = obj[key];
        const expectedType = schema.keyTypes[key];
        if (expectedType && typeof val !== expectedType) errors.push(`Key "${key}" has wrong type: expected ${expectedType}, got ${typeof val}`);
      }
      if (schema.enumConstraints) {
        for (const [key, allowedValues] of Object.entries(schema.enumConstraints)) {
          if (key in obj && obj[key] && !allowedValues.includes(obj[key])) errors.push(`Key "${key}" has invalid value "${obj[key]}". Allowed: ${allowedValues.join(', ')}`);
        }
      }
      if (schema.maxLengths) {
        for (const [key, maxLen] of Object.entries(schema.maxLengths)) {
          if (key in obj && obj[key] && typeof obj[key] === 'string' && obj[key].length > maxLen) errors.push(`Key "${key}" exceeds max length of ${maxLen} (got ${obj[key].length})`);
        }
      }
      return errors.length === 0 ? { valid: true } : { valid: false, errors };
    }

    // Schema example for retry instructions
    function getSchemaExample(schemaName) {
      if (schemaName === 'lookup') {
        return { name: '', house: '', conc: 'EDP', family: 'Floral', top: '', middle: '', base: '', season: 'Ganzjährig', gender: 'Unisex' };
      }
      if (schemaName === 'dayParams') {
        return { occasion: 'casual', mood: 'calm', timeOfDay: 'evening', intensityPref: 'medium', longevityPref: 'medium', reasoning: 'Erklärung warum diese Werte passen.' };
      }
      return {};
    }

    // Fetch JSON with automatic retry on schema violation
    async function fetchJsonWithRetry(groqFetchFn, messages, options = {}) {
      const { schemaName = 'lookup', maxRetries = 2, baseTemperature = 0.2, maxTokens = 600, cacheKey = null, forceFallback = false } = options;
      let lastError = null;
      let currentTemperature = baseTemperature;
      let currentMessages = [...messages];

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await groqFetchFn({ messages: currentMessages, temperature: currentTemperature, max_tokens: maxTokens, cacheKey, forceFallback });
          const raw = response.text;

          // Extract JSON from response (handle markdown fences, etc.)
          let parsed = null;
          const extractStrategies = [
            s => s.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim(),
            s => { const m = s.match(/\{[\s\S]*\}/); return m ? m[0] : null; },
            s => { const m = s.match(/\{[^{}]*\}/); return m ? m[0] : null; }
          ];

          for (const strategy of extractStrategies) {
            try { const extracted = strategy(raw); if (extracted) { parsed = JSON.parse(extracted); break; } } catch {}
          }

          if (!parsed) throw new Error('No valid JSON found in response');

          const validation = validateJsonSchema(parsed, schemaName);
          if (validation.valid) return { parsed, fromCache: response.fromCache, model: response.model };

          lastError = new Error(`Schema validation failed: ${validation.errors.join('; ')}`);

          if (attempt < maxRetries) {
            const strictInstruction = `\n\nWICHTIG: Vorherige Antwort war ungültig. Antworte AUSSCHLIEßLICH mit exakt diesem JSON-Schema (kein Markdown, kein Text davor/danach):\n${JSON.stringify(getSchemaExample(schemaName))}`;
            const lastMsg = currentMessages[currentMessages.length - 1];
            if (lastMsg && lastMsg.role === 'user') {
              currentMessages = [...currentMessages.slice(0, -1), { ...lastMsg, content: lastMsg.content + strictInstruction }];
            }
            currentTemperature = Math.max(0.1, currentTemperature - 0.1);
            continue;
          }
        } catch (e) {
          lastError = e;
          if (attempt < maxRetries) { currentTemperature = Math.max(0.1, currentTemperature - 0.1); continue; }
        }
      }
      throw lastError || new Error('Failed to fetch valid JSON after retries');
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // GROQ TOKEN MANAGER v2 – Model Rotation, Rate-Limit-Tracking, Offline-Cache
    // Primäres Modell: openai/gpt-oss-120b
    // Fallback-Modelle: qwen/qwen3.8-27b, openai/gpt-oss-20b
    // Strategie: Requests-Budget schonen, schnell rotieren bei 429
    // ══════════════════════════════════════════════════════════════════════════════
    const GTM_MODEL_POOL = [
      { id: "openai/gpt-oss-120b",  reqPerMin: 30, quality: "high" },
      { id: "qwen/qwen3.8-27b",     reqPerMin: 30, quality: "medium" },
      { id: "openai/gpt-oss-20b",   reqPerMin: 30, quality: "medium" },
    ];
    const GTM_COOLDOWN_MS = 62000; // 62s nach 429

        const _gtmState = {};
    GTM_MODEL_POOL.forEach(m => {
      _gtmState[m.id] = {
        blockedUntil: 0, lastUsed: 0,
        reqRemainingDay: 30, reqResetDayAt: 0,   // RPD-Header (Requests per Day)
        tokRemaining: 8000, tokResetAt: 0,        // TPM-Header (Tokens per Minute)
      };
    });

    const _groqOfflineCache = {};
    let _groqRetryAfterUntil = 0;

    function groqSetOfflineCache(cacheKey, text) {
      if (!cacheKey || !text) return;
      _groqOfflineCache[cacheKey] = text;
      try {
        const all = JSON.parse(localStorage.getItem("parfum_groq_cache_v1") || "{}");
        all[cacheKey] = text;
        const keys = Object.keys(all);
        if (keys.length > 30) delete all[keys[0]];
        localStorage.setItem("parfum_groq_cache_v1", JSON.stringify(all));
      } catch {}
    }
    function groqGetOfflineCache(cacheKey) {
      if (_groqOfflineCache[cacheKey]) return _groqOfflineCache[cacheKey];
      try {
        const all = JSON.parse(localStorage.getItem("parfum_groq_cache_v1") || "{}");
        return all[cacheKey] || null;
      } catch { return null; }
    }

    function _gtmParseHeaders(headers, modelId) {
      const s = _gtmState[modelId];
      if (!s) return;
      const remReq = headers.get("x-ratelimit-remaining-requests");
      const resetReq = headers.get("x-ratelimit-reset-requests");
      if (remReq !== null) s.reqRemainingDay = parseInt(remReq);
      if (resetReq) {
        const secs = parseFloat(resetReq.replace("s",""));
        s.reqResetDayAt = Date.now() + secs * 1000;
      }
      const remTok = headers.get("x-ratelimit-remaining-tokens");
      const resetTok = headers.get("x-ratelimit-reset-tokens");
      if (remTok !== null) s.tokRemaining = parseInt(remTok);
      if (resetTok) {
        const secs = parseFloat(resetTok.replace("s", ""));
        s.tokResetAt = Date.now() + secs * 1000;
      }
      s.lastUsed = Date.now();
    }

    function _gtmSelectModel() {
      const now = Date.now();
      for (const m of GTM_MODEL_POOL) {
        const s = _gtmState[m.id];
        if (s.blockedUntil > now) continue;
        // Tages-Reset prüfen
        if (s.reqResetDayAt > 0 && now >= s.reqResetDayAt) { s.reqRemainingDay = m.reqPerMin; s.reqResetDayAt = 0; }
        // Token-Reset prüfen
        if (s.tokResetAt > 0 && now >= s.tokResetAt) { s.tokRemaining = 8000; s.tokResetAt = 0; }
        // Modell überspringen, wenn Request- oder Token-Budget erschöpft
        if (s.reqRemainingDay <= 1 || s.tokRemaining <= 0) continue;
        return m;
      }
      // alle erschöpft → frühestes Reset (beide Metriken)
      return GTM_MODEL_POOL.reduce((best, m) => {
        const bt = Math.max(_gtmState[m.id].blockedUntil, _gtmState[m.id].reqResetDayAt, _gtmState[m.id].tokResetAt);
        const bb = Math.max(_gtmState[best.id].blockedUntil, _gtmState[best.id].reqResetDayAt, _gtmState[best.id].tokResetAt);
        return bt < bb ? m : best;
      });
    }

    async function groqFetch({ messages, temperature = 0.4, max_tokens = 200, cacheKey = null, forceFallback = false }) {
      const apiKey = getGroqKey();
      if (!apiKey) { log('ERROR', 'Groq API key missing'); throw new ApiError('Kein Groq API-Key – bitte unter Settings → API eintragen.'); }

      const now = Date.now();
      const retryWaitSec = Math.ceil((_groqRetryAfterUntil - now) / 1000);

      const pool = forceFallback ? GTM_MODEL_POOL.slice(1) : GTM_MODEL_POOL;
      let lastErr = null;

      for (const modelDef of pool) {
        const s = _gtmState[modelDef.id];
        if (s.blockedUntil > Date.now()) continue;

        try {
          const res = await fetch(GROQ_CHAT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
            body: JSON.stringify({ model: modelDef.id, temperature, max_completion_tokens: max_tokens, messages }),
          });

          _gtmParseHeaders(res.headers, modelDef.id);

          if (res.status === 429) {
            const retryAfter = parseInt(res.headers?.get?.("retry-after") || "62", 10);
            const waitMs = isNaN(retryAfter) ? GTM_COOLDOWN_MS : Math.min(retryAfter * 1000, 300000);
            s.blockedUntil = Date.now() + waitMs;
            lastErr = new RateLimitError(`Rate-Limit für ${modelDef.id}, wechsle zum nächsten Modell`, { retryAfter: Math.ceil(waitMs / 1000) });
            log('WARN', `Rate limit hit on ${modelDef.id}`, { retryAfter: Math.ceil(waitMs/1000) });
            continue;
          }

          if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            const errMsg = e?.error?.message || `HTTP ${res.status}`;
            if (res.status >= 500) {
              lastErr = new NetworkError(`Server nicht erreichbar (${res.status}). Bitte später erneut versuchen.`);
            } else if (res.status >= 400 && res.status < 500) {
              lastErr = new ApiError(`API-Fehler (${res.status}): ${errMsg}`);
            } else {
              lastErr = new ApiError(`Unerwartete Antwort (${res.status})`);
            }
            log('WARN', `HTTP ${res.status} on ${modelDef.id}`, { error: errMsg });
            continue;
          }

          const data = await res.json();
          const text = data.choices?.[0]?.message?.content?.trim();
          if (!text) { lastErr = new InvalidResponseError('Keine Textantwort von KI erhalten.'); continue; }

          _groqRetryAfterUntil = 0;
          if (cacheKey) groqSetOfflineCache(cacheKey, text);
          return { text, fromCache: false, model: modelDef.id };
        } catch (e) {
          lastErr = e instanceof AppError ? e : handleApiError(e, { context: 'groqFetch' });
          log('WARN', `Fetch error on ${modelDef.id}`, { error: e.message });
        }
      }

      const allBlocked = pool.every(m => _gtmState[m.id].blockedUntil > Date.now());
      if (allBlocked) {
        const earliest = pool.reduce((min, m) => Math.min(min, _gtmState[m.id].blockedUntil), Infinity);
        _groqRetryAfterUntil = earliest;
      }

      if (cacheKey) {
        const cached = groqGetOfflineCache(cacheKey);
        if (cached) return { text: cached, fromCache: true, model: "cache", retryAfterSec: retryWaitSec > 0 ? retryWaitSec : 0 };
      }

      throw lastErr || new NetworkError('Groq API nicht erreichbar. Bitte verbinden Sie sich später erneut.');
    }

    // ── Countdown Hook für Rate-Limit-Anzeige ────────────────────────────────────
    function useGroqCountdown() {
      const [sec, setSec] = useState(0);
      useEffect(() => {
        const tick = () => {
          const remaining = Math.ceil((_groqRetryAfterUntil - Date.now()) / 1000);
          setSec(remaining > 0 ? remaining : 0);
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
      }, []);
      return sec;
    }

    // ── buildPromptContext: skalierbare KI-Parameter ─────────────────────────────
    // Erweiterbar: neue Felder einfach im params-Objekt ergänzen.
    function buildPromptContext(params) {
      const {
        occasion, mood, timeOfDay, weather, season,
        intensityPref, longevityPref,
        // Erweiterte Parameter (optional):
        priceRange = null,        // "budget"|"mid"|"luxury"
        genderPref = null,        // "feminin"|"maskulin"|"unisex"
        userFamilyPrefs = [],     // bevorzugte Familien (aus Onboarding)
      } = params;

      const occasionLabels = { casual: "Alltag", work: "Büro", sport: "Sport", evening: "Abend",
        date: "Date/Romantik", sleep: "Schlafen", special: "Besonderer Anlass",
        outdoor: "Outdoor", travel: "Reise", vacation: "Urlaub" };
      const moodLabels = { energetic: "energetisch", calm: "entspannt", romantic: "romantisch",
        confident: "selbstsicher", mysterious: "geheimnisvoll", playful: "verspielt", sleep: "schläfrig/ruhig" };
      const timeLabels = { morning: "morgens", afternoon: "mittags", evening: "abends", night: "nachts" };
      const weatherLabels = { sunny: "sonnig", cloudy: "bewölkt", rainy: "regnerisch", cold: "kalt", hot: "heiß" };
      const intensityLabels = { light: "leicht/dezent", medium: "mittel", strong: "stark/projizierend" };
      const priceLabels = { budget: "unter 30€", mid: "30–100€", luxury: "über 100€" };

      let ctx = `Kontext für Parfum-Empfehlung:
- Anlass: ${occasionLabels[occasion] || occasion}
- Stimmung: ${moodLabels[mood] || mood}
- Tageszeit: ${timeLabels[timeOfDay] || timeOfDay}
- Wetter: ${weatherLabels[weather] || weather}
- Jahreszeit: ${season}
- Intensität: ${intensityLabels[intensityPref] || intensityPref}
- Haltbarkeit: ${longevityPref === "long" ? "lang" : longevityPref === "short" ? "kurz" : "mittel"}`;

      if (priceRange) ctx += `
- Preisbereich: ${priceLabels[priceRange] || priceRange}`;
      if (genderPref) ctx += `
- Präferenz: ${genderPref}`;
      if (userFamilyPrefs && userFamilyPrefs.length > 0) {
        ctx += `
- Lieblingsduftfamilien: ${userFamilyPrefs.slice(0, 4).join(", ")}`;
      }
      return ctx;
    }
    async function fetchPageTextForLookup(safeUrl) {
      const jinaUrl = "https://r.jina.ai/" + safeUrl;
      try {
        const r = await fetch(jinaUrl, {
          headers: {
            "X-Return-Format": "markdown",
            "X-No-Cache": "true",
          }
        });
        if (r.ok) {
          const t = await r.text();
          if (t && t.length > 80) {
            return buildTextFromJina(t);
          }
        }
      } catch (e) {
      }
      throw new Error("Seiteninhalt konnte nicht geladen werden. Bitte Parfumo-URL prüfen oder später erneut versuchen.");
    }
    function buildTextFromHtml(html) {
      // Noten direkt aus der Pyramiden-Struktur extrahieren (alt-Attribute der Note-Bilder)
      function extractNoteBlock(html, blockClass) {
        const blockMatch = safeExtractBlock(html, blockClass);
        if (!blockMatch) return "";
        const alts = [];
        const blockContent = blockMatch;
        // Alt-Texte aus dem Block extrahieren – mit Längenbegrenzung
        const altMatches = safeRegexMatch(blockContent, 'alt="([^"]+)"', 'g');
        if (altMatches) {
          for (const m of altMatches) {
            const val = (m[1] || "").trim();
            if (val && !["Kopfnote","Herznote","Basisnote","Kopfnoten","Herznoten","Basisnoten"].includes(val)) {
              alts.push(val);
            }
          }
        }
        return alts.join(" · ");
      }
      const topNotes    = extractNoteBlock(html, "nb_t");
      const middleNotes = extractNoteBlock(html, "nb_m");
      const baseNotes   = extractNoteBlock(html, "nb_b");

      // Restlichen Text für Name, Haus, Konzentration, Familie, Saison, Geschlecht
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const notesHint = topNotes || middleNotes || baseNotes
        ? `\n\nExtrahierte Duftpyramide (bereits korrekt getrennt, bitte genau so übernehmen):\nKopfnoten: ${topNotes || "–"}\nHerznoten: ${middleNotes || "–"}\nBasisnoten: ${baseNotes || "–"}`
        : "";

      const strippedLower = stripped.toLowerCase();
      const hasIngredientsHtml = !topNotes && !middleNotes && !baseNotes &&
        (strippedLower.includes("inhaltsstoff") || strippedLower.includes("ingredient") ||
         strippedLower.includes("inci") || strippedLower.includes("zutaten"));
      const ingredientsHintHtml = hasIngredientsHtml
        ? "\n\nHINWEIS: Diese Seite enthält keine Duftpyramide (keine Kopf-/Herz-/Basisnoten), nur Inhaltsstoffe/INCI. Extrahiere erkennbare Duftstoffe aus dem Inhaltsstoffabschnitt und trage sie ausschließlich in 'base' ein. 'top' und 'middle' leer lassen."
        : "";

      return stripped.slice(0, LOOKUP_PAGE_MAX_CHARS) + notesHint + ingredientsHintHtml;
    }
    function buildTextFromJina(text) {
      // Jina rendert Parfumo-Noten als: ![Image N: NoteName](url)NoteName
      // Die Pyramiden-Blöcke sind: "Kopfnote\n\n![...]NoteName![...]NoteName"
      // Basisnoten werden von Jina oft NICHT als eigener Block gerendert – direkt aus dem Bild-Muster extrahieren

      function extractNotesFromBlock(block) {
        // Muster: ![Image N: NoteName](url)NoteName  – NoteName erscheint zweimal
        const notes = [];
        const re = /!\[Image \d+:\s*([^\]]+)\]\([^)]+\)/g;
        let m;
        while ((m = re.exec(block)) !== null) {
          const name = m[1].trim();
          if (name && !["Kopfnote","Herznote","Basisnote","Kopfnoten","Herznoten","Basisnoten","Inspiration"].includes(name)) {
            notes.push(name);
          }
        }
        return notes.join(" · ");
      }

      // Pyramiden-Abschnitt finden: zwischen "## Duftpyramide" und nächstem "##"
      const pyramideStart = text.indexOf("## Duftpyramide");
      const pyramideEnd   = pyramideStart >= 0 ? text.indexOf("##", pyramideStart + 10) : -1;
      const pyramideBlock = pyramideStart >= 0
        ? (pyramideEnd > pyramideStart ? text.slice(pyramideStart, pyramideEnd) : text.slice(pyramideStart, pyramideStart + 3000))
        : "";


      // Innerhalb des Blocks: Kopf/Herz/Basis-Sektionen trennen
      function extractSection(block, startMarker, endMarker) {
        const lower = block.toLowerCase();
        const s = lower.indexOf(startMarker.toLowerCase());
        if (s === -1) return "";
        const e = endMarker ? lower.indexOf(endMarker.toLowerCase(), s + startMarker.length) : -1;
        const section = e > -1 ? block.slice(s, e) : block.slice(s);
        return extractNotesFromBlock(section);
      }

      const topNotes    = extractSection(pyramideBlock, "Kopfnote", "Herznote");
      const middleNotes = extractSection(pyramideBlock, "Herznote", "Basisnote");
      // Basisnoten: erst im Pyramide-Block suchen, dann im gesamten Text (Jina lässt nb_b manchmal weg)
      let baseNotes = extractSection(pyramideBlock, "Basisnote", "");
      if (!baseNotes) {
        // Suche im vollen Text nach dem Basisnoten-Bild-Muster direkt nach "Basisnote"
        const fullLower = text.toLowerCase();
        const bIdx = fullLower.lastIndexOf("basisnote");
        if (bIdx >= 0) {
          const bBlock = text.slice(bIdx, bIdx + 2000);
          baseNotes = extractNotesFromBlock(bBlock);
        }
      }


      const notesHint = topNotes || middleNotes || baseNotes
        ? "\n\nExtrahierte Duftpyramide (bereits korrekt getrennt, bitte genau so übernehmen):\nKopfnoten: " + (topNotes || "–") + "\nHerznoten: " + (middleNotes || "–") + "\nBasisnoten: " + (baseNotes || "–")
        : "";

      // Detect ingredient-only pages: no pyramid but INCI/ingredients section present
      const lowerText = text.toLowerCase();
      const hasIngredients = !topNotes && !middleNotes && !baseNotes &&
        (lowerText.includes("inhaltsstoff") || lowerText.includes("ingredient") ||
         lowerText.includes("inci") || lowerText.includes("zutaten"));
      const ingredientsHint = hasIngredients
        ? "\n\nHINWEIS: Diese Seite enthält keine Duftpyramide (keine Kopf-/Herz-/Basisnoten), nur Inhaltsstoffe/INCI. Extrahiere erkennbare Duftstoffe aus dem Inhaltsstoffabschnitt und trage sie ausschließlich in 'base' ein. 'top' und 'middle' leer lassen."
        : "";
      // Seitentext bereinigen: Bild-URLs und Rezensionen kürzen um Token zu sparen
      const cleaned = text
        .replace(/!\[([^\]]*)\]\([^)]{20,}\)/g, (_, alt) => alt ? "[" + alt + "]" : "")  // lange Bild-URLs kürzen
        .replace(/https?:\/\/\S+/g, "")           // restliche URLs entfernen
                .replace(/\n{3,}/g, "\n\n")               // mehrfache Leerzeilen kürzen
        .trim();
      return cleaned.slice(0, LOOKUP_PAGE_MAX_CHARS) + notesHint + ingredientsHint;
    }

    function normalizeLookupPayload(obj) {
      if (!obj || typeof obj !== "object") throw new Error("Ungültige API-Antwort");
      const pick = (k, max) => {
        const v = obj[k];
        return v == null ? "" : String(v).slice(0, max);
      };
      return {
        name: pick("name", 400), house: pick("house", 200), conc: pick("conc", 40),
        family: pick("family", 80), top: pick("top", 2000), middle: pick("middle", 2000), base: pick("base", 2000),
        season: pick("season", 40), gender: pick("gender", 40),
      };
    }
    function parseTSV(text) {
      if (typeof text !== "string" || text.length > MAX_TSV_CHARS) return [];
      const cleaned = text.replace(/^\uFEFF/, "").trim();
      const lines = cleaned.split(/\r?\n/).filter(l => l.trim());
      if (lines.length > MAX_TSV_LINES || lines.length < 2) return [];
      const h = lines[0].split("\t").map(x => x.trim().toLowerCase());
      const idx = k => h.findIndex(x => x.includes(k));
      const m = {
        name: idx("name"), house: idx("haus"), conc: idx("konz"), family: idx("famil"),
        top: idx("kopf"), middle: idx("herz"), base: idx("basis"), season: idx("saison"),
        gender: idx("geschl"), format: idx("format"), url: idx("link"),
        rating: idx("bewertung") >= 0 ? idx("bewertung") : idx("rating")
      };
      return lines.slice(1).map(line => {
        const c = line.split("\t"); const g = k => k >= 0 ? (c[k] || "").trim() : "";
        const rawRating = parseInt(g(m.rating), 10);
        return sanitizePerfume({
          id: newId(), name: g(m.name), house: g(m.house), conc: g(m.conc),
          family: g(m.family) || "Sonstiges", top: g(m.top), middle: g(m.middle), base: g(m.base),
          season: g(m.season) || "Ganzjährig", gender: g(m.gender) || "Unisex",
          format: g(m.format) || "Probe", url: g(m.url),
          rating: isNaN(rawRating) ? 0 : Math.min(5, Math.max(0, rawRating))
        });
      }).filter(p => p.name);
    }
    function downloadTSV(items) {
      const h = ["Name", "Haus", "Konzentration", "Familie", "Kopfnoten", "Herznoten",
        "Basisnoten", "Saison", "Geschlecht", "Format", "Bewertung", "Parfumo Link"];
      const rows = items.map(p => [p.name, p.house, p.conc, p.family, p.top, p.middle,
      p.base, p.season, p.gender, p.format, p.rating ?? 0, p.url].map(sanitizeField).join("\t"));
      const uri = "data:text/tab-separated-values;charset=utf-8," + encodeURIComponent([h.join("\t"), ...rows].join("\n"));
      const a = document.createElement("a"); a.href = uri; a.download = "parfum_sammlung.tsv"; a.click();
    }
    async function lookupByUrl(url) {
      const safeUrl = validateParfumoLookupUrl(url);
      const pageText = await fetchPageTextForLookup(safeUrl);
      const system = "Extrahiere Parfüm-Daten aus Seitentext. Nur JSON, kein Markdown.";
      const user = `Parfumo-Seitentext. Extrahiere: Name, Haus, Konz, Familie, Noten (Kopf/Herz/Basis), Saison, Geschlecht.
Duftpyramide: Noten zwischen Kopfnote/Herznote/Basisnote-Markierungen extrahieren.
Mapping: Blumig→Floral, Holzig→Woody, Orientalisch→Oriental, Frisch→Fresh, Gourmand/Süß→Gourmand, Marin→Aquatisch.
Nur JSON:
{"name":"","house":"","conc":"EDP|EDT|Parfum|EDC|Extrait","family":"Floral|Woody|Oriental|Fresh|Chypre|Fougère|Gourmand|Aquatisch|Sonstiges","top":"","middle":"","base":"","season":"Frühling|Sommer|Herbst|Winter|Ganzjährig","gender":"Unisex|Feminin|Maskulin"}

` + pageText;
      // Lookup needs the big model - small fallback can't handle 16k chars of page text.
      // If big model fails due to rate-limit, truncate the page text and retry with fallback.
      let lookupRaw;
      try {
        const r = await groqFetch({
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          temperature: 0.2, max_tokens: 600,
          cacheKey: "lookup:" + safeUrl.slice(-60),
          forceFallback: false,
        });
        lookupRaw = r.text;
      } catch(firstErr) {
        // If rate-limited, retry with aggressively truncated text on fallback model
        const truncatedUser = user.slice(0, 2000) + "\n[Text gekürzt – bitte kurze Antwort]";
        const r2 = await groqFetch({
          messages: [{ role: "system", content: system }, { role: "user", content: truncatedUser }],
          temperature: 0.2, max_tokens: 400,
          cacheKey: "lookup-short:" + safeUrl.slice(-60),
          forceFallback: true,
        });
        lookupRaw = r2.text;
      }
      const { text: raw } = { text: lookupRaw };
      // Robust JSON extraction: try multiple strategies
      function extractJSON(str) {
        // 1. Strip markdown fences and try direct parse
        const stripped = str.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        try { return JSON.parse(stripped); } catch {}
        // 2. Find last complete {...} block (greedy, picks outermost)
        const m = stripped.match(/\{[\s\S]*\}/);
        if (m) { try { return JSON.parse(m[0]); } catch {} }
        // 3. Find first {...} block (non-greedy)
        const m2 = stripped.match(/\{[^{}]*\}/);
        if (m2) { try { return JSON.parse(m2[0]); } catch {} }
        return null;
      }
      const parsed = extractJSON(raw);
      if (!parsed) throw new InvalidResponseError("KI-Antwort enthielt kein lesbares JSON. Bitte nochmal versuchen.");
      return normalizeLookupPayload(parsed);
    }

    // ── Styles ────────────────────────────────────────────────────────────────────
    const S = {
      app: { fontFamily: "'Georgia',serif", maxWidth: "100%", height: "100%", background: "#FAFAF8", display: "flex", flexDirection: "column", overflow: "hidden" },
      hdr: { padding: "calc(12px + env(safe-area-inset-top)) 16px 0", borderBottom: "1px solid #E8E6E0" },
      tabs: {
        display: "flex", flexWrap: "nowrap", overflowX: "auto", scrollBehavior: "smooth", gap: 0,
        paddingBottom: 4, scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch",
        minHeight: 44, alignItems: "center", position: "sticky", top: 0, background: "#FAFAF8", zIndex: 100
      },
      tab: a => ({ flex: "0 0 auto", minWidth: 44, maxWidth: 56, padding: "6px 4px", background: "none", border: "none", cursor: "pointer", fontSize: 8, fontFamily: "'Georgia',serif", color: a ? "#1A1A18" : "#7A7975", borderBottom: `2px solid ${a ? "#1A1A18" : "transparent"}`, transition: "all .3s cubic-bezier(0.25,.46,.45,.94)", letterSpacing: "0px", whiteSpace: "nowrap", fontWeight: a ? 500 : 400, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 44 }),
      dtab: a => ({ padding: "10px 14px", minHeight: 44, background: "none", border: "none", cursor: "pointer", fontSize: 12, fontFamily: "'Georgia',serif", color: a ? "#1A1A18" : "#888780", borderBottom: `2px solid ${a ? "#1A1A18" : "transparent"}`, transition: "all .3s cubic-bezier(0.25,.46,.45,.94)" }),
      body: { flex: 1, overflow: "visible", padding: "16px", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" },
      card: { background: "#fff", border: "1px solid #E8E6E0", borderRadius: 12, padding: "16px", marginBottom: 12, boxShadow: "0 1px 3px rgba(26,26,24,0.04)" },
      pill: c => ({ display: "inline-block", fontSize: 10, padding: "2px 8px", borderRadius: 20, background: c + "22", color: c, letterSpacing: "0.3px", transition: "all .3s ease" }),
      lbl: { fontSize: 10, letterSpacing: "1.5px", color: "#888780", marginBottom: 8 },
      inp: { width: "100%", padding: "10px 12px", border: "1px solid #D3D1C7", borderRadius: 8, fontSize: 14, fontFamily: "'Georgia',serif", background: "#fff", color: "#1A1A18", boxSizing: "border-box", transition: "all .3s ease", outline: "none" },
      ta: { width: "100%", padding: "10px 12px", border: "1px solid #D3D1C7", borderRadius: 8, fontSize: 13, fontFamily: "'Georgia',serif", background: "#fff", color: "#1A1A18", boxSizing: "border-box", resize: "vertical", minHeight: 80, lineHeight: 1.6, transition: "all .3s ease", outline: "none" },
      btn: v => ({ padding: v === "lg" ? "14px 24px" : v === "sm" ? "6px 12px" : "10px 16px", minHeight: v === "sm" ? 36 : 44, borderRadius: 8, border: v === "out" ? "1px solid #D3D1C7" : "none", background: v === "pri" ? "#1A1A18" : v === "out" ? "transparent" : "#F1EFE8", color: v === "pri" ? "#fff" : "#1A1A18", cursor: "pointer", fontSize: 13, fontFamily: "'Georgia',serif", transition: "all .4s cubic-bezier(0.25,.46,.45,.94)", boxShadow: v === "pri" ? "0 4px 15px rgba(26,26,24,0.2)" : "none" }),
      chip: (a, c) => ({ padding: "10px 14px", minHeight: 44, borderRadius: 20, border: `1px solid ${a ? (c || "#1A1A18") : "#D3D1C7"}`, background: a ? (c || "#1A1A18") : "transparent", color: a ? "#fff" : "#1A1A18", fontSize: 12, cursor: "pointer", fontFamily: "'Georgia',serif", transition: "all .3s cubic-bezier(0.25,.46,.45,.94)" }),
      skeleton: (w = "100%", h = 12) => ({ width: w, height: h, borderRadius: 6, background: "linear-gradient(90deg,#E8E6E0 25%,#F5F4F1 50%,#E8E6E0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite" }),
    };


    // ── Pull-to-refresh component ─────────────────────────────────────────────────
    function PullToRefresh({ children, tabKey }) {
      const ref = useRef(null);
      // Reset scroll position to top when tab changes
      useEffect(() => {
        if (ref.current) ref.current.scrollTop = 0;
      }, [tabKey]);
      return (
        <div ref={ref} id="main-scroll-container"
          style={{
            flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
            overscrollBehavior: "none", WebkitOverflowScrolling: "touch",
            animation: "fadeIn .3s ease-out"
          }}>
          {children}
        </div>
      );
    }

    // ── MiniBar helper ────────────────────────────────────────────────────────────
    function MiniBar({ pct, color, height = 5 }) {
      return (
        <div style={{ height, background: "#F1EFE8", borderRadius: 3, overflow: "hidden", flex: 1 }}>
          <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: color, borderRadius: 3, transition: "width .5s" }} />
        </div>
      );
    }

    // ── Star rating ───────────────────────────────────────────────────────────────
    function Stars({ rating, onSet, size = 18 }) {
      return (
        <div style={{ display: "flex", gap: 2 }} role="group" aria-label={`Bewertung: ${rating || 0} von 5 Sternen`}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} onClick={() => onSet && onSet(n)}
              aria-label={`${n} Stern${n > 1 ? "e" : ""}`}
              aria-pressed={n <= (rating || 0)}
              style={{
                background: "none", border: "none", fontSize: size, cursor: onSet ? "pointer" : "default",
                color: n <= (rating || 0) ? "#BA7517" : "#D3D1C7", padding: "6px 4px", lineHeight: 1, minHeight: 36, minWidth: 28
              }}>★</button>
          ))}
        </div>
      );
    }


    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: ERROR HANDLING SYSTEM
    // ══════════════════════════════════════════════════════════════════════════════

    // Kategorien: 'user' | 'system' | 'network' | 'api'
    function classifyError(err) {
      const msg = String(err?.message || err || "");
      if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed to fetch"))
        return { kind: "network", label: "Keine Verbindung", hint: "Prüfe deine Internetverbindung und versuche es erneut." };
      if (msg.includes("429") || msg.includes("rate"))
        return { kind: "api", label: "Zu viele Anfragen", hint: "Kurz warten und nochmal versuchen." };
      if (msg.includes("401") || msg.includes("403"))
        return { kind: "api", label: "Zugriff verweigert", hint: "Der externe Dienst ist momentan nicht erreichbar." };
      if (msg.includes("JSON") || msg.includes("parse"))
        return { kind: "user", label: "Ungültiges Dateiformat", hint: "Bitte prüfe deine TSV-Datei." };
      return { kind: "system", label: "Unbekannter Fehler", hint: "Bitte App neu laden und nochmal versuchen." };
    }

    // Retry mit exponential backoff
    async function withRetry(fn, maxAttempts = 3, baseDelay = 1000) {
      let lastErr;
      for (let i = 0; i < maxAttempts; i++) {
        try { return await fn(); }
        catch (e) {
          lastErr = e;
          if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
        }
      }
      throw lastErr;
    }

    // Globaler Error-Banner
    function ErrorBanner({ errors, onDismiss }) {
      if (!errors.length) return null;
      return (
        <div role="alert" aria-live="assertive"
          style={{
            position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
            width: "min(480px,100vw)", zIndex: 9999, padding: "0 0 8px"
          }}>
          {errors.map(e => (
            <div key={e.id} style={{
              background: e.kind === "user" ? "#FFF4E5" : "#FEF2F2",
              border: `1px solid ${e.kind === "user" ? "#F59E0B" : "#F87171"}`,
              borderRadius: 8, padding: "10px 14px", margin: "8px 8px 0",
              display: "flex", gap: 10, alignItems: "flex-start",
              boxShadow: "0 4px 12px rgba(0,0,0,.1)"
            }}>
              <div style={{ fontSize: 16, flexShrink: 0 }} aria-hidden="true">{e.kind === "user" ? "⚠" : "◈"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#1A1A18", marginBottom: 2 }}>{e.label}</div>
                <div style={{ fontSize: 11, color: "#888780" }}>{e.hint}</div>
                {e.action && <button onClick={e.action.fn} style={{
                  fontSize: 11, color: "#185FA5",
                  background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 4
                }}>
                  {e.action.label}</button>}
              </div>
              <button onClick={() => onDismiss(e.id)} aria-label="Fehlermeldung schließen"
                style={{
                  background: "none", border: "none", cursor: "pointer", fontSize: 14,
                  color: "#B4B2A9", padding: 0, flexShrink: 0
                }}>✕</button>
            </div>
          ))}
        </div>
      );
    }

    // Hook für globalen Error-State
    function useErrorSystem() {
      const [errors, setErrors] = useState([]);
      const pushError = useCallback((err, opts = {}) => {
        const classified = classifyError(err);
        const entry = { id: Date.now() + "_" + Math.random(), ...classified, ...opts };
        setErrors(prev => [...prev.slice(-2), entry]);
        setTimeout(() => setErrors(prev => prev.filter(e => e.id !== entry.id)), 8000);
        return entry;
      }, []);
      const dismiss = useCallback(id => setErrors(prev => prev.filter(e => e.id !== id)), []);
      return { errors, pushError, dismiss };
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: WEATHER API (Open-Meteo – kein API-Key nötig)
    // ══════════════════════════════════════════════════════════════════════════════
    const WMO_TO_WEATHER = {
      0: "sunny", 1: "sunny", 2: "cloudy", 3: "cloudy",
      45: "cloudy", 48: "cloudy",
      51: "rainy", 53: "rainy", 55: "rainy",
      61: "rainy", 63: "rainy", 65: "rainy",
      71: "cold", 73: "cold", 75: "cold",
      80: "rainy", 81: "rainy", 82: "rainy",
      95: "rainy", 96: "rainy", 99: "rainy",
    };

    async function fetchWeather(lat, lon) {
      const la = Number(lat), lo = Number(lon);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new Error("Ungültige Koordinaten");
      const clampLat = Math.max(-90, Math.min(90, la));
      const clampLon = Math.max(-180, Math.min(180, lo));
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(clampLat))}&longitude=${encodeURIComponent(String(clampLon))}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
      const data = await res.json();
      const c = data && data.current;
      if (!c || typeof c.temperature_2m !== "number") throw new Error("Wetterdaten unvollständig");
      const code = typeof c.weather_code === "number" ? c.weather_code : 0;
      const hum = typeof c.relative_humidity_2m === "number" ? c.relative_humidity_2m : 50;
      return {
        temp: c.temperature_2m,
        humidity: hum,
        wmoCode: code,
        weather: WMO_TO_WEATHER[code] ?? "cloudy",
        effectiveWeather: c.temperature_2m < 8 ? "cold"
          : c.temperature_2m > 26 ? "hot"
            : WMO_TO_WEATHER[code] ?? "cloudy",
      };
    }

    // Intensitäts-Korrektur durch Luftfeuchtigkeit:
    // hohe Luftfeuchtigkeit → Projektion steigt, subtilere Düfte bevorzugen
    function humidityIntensityMod(humidity) {
      if (humidity > 80) return "light";    // sehr feucht → dezent
      if (humidity > 60) return null;       // normal → keine Änderung
      if (humidity < 30) return "strong";   // trocken → stärkere Noten möglich
      return null;
    }

    function WeatherWidget({ weatherData, onUse }) {
      if (!weatherData) return null;
      const w = weatherData;
      const icon = w.effectiveWeather === "sunny" ? "☀" : w.effectiveWeather === "hot" ? "🌡" :
        w.effectiveWeather === "cold" ? "❄" : w.effectiveWeather === "rainy" ? "☁" : "◎";
      return (
        <div style={{
          background: "#F1EFE8", borderRadius: 8, padding: "8px 12px",
          display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            <div>
              <div style={{ fontSize: 13, color: "#1A1A18" }}>{Math.round(w.temp)}°C · {w.humidity}% Luftfeuchte</div>
              <div style={{ fontSize: 10, color: "#888780" }}>Automatisch erkanntes Wetter wird berücksichtigt</div>
            </div>
          </div>
          <button onClick={onUse} style={{ ...S.btn("pri"), fontSize: 10, padding: "5px 10px", borderRadius: 16 }}>
            Anwenden
          </button>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: FILL-LEVEL (NUR FLAKONS)
    // ══════════════════════════════════════════════════════════════════════════════
    const FILL_LEVELS = [100, 75, 50, 25, 0];
    const FILL_LABELS = { 100: "Voll", 75: "¾", 50: "½", 25: "¼", 0: "Leer" };
    const FILL_COLORS = { 100: "#1D9E75", 75: "#0F6E56", 50: "#BA7517", 25: "#E24B4A", 0: "#5F5E5A" };

    function FillLevelEditor({ item, fillLevels, onSetFill }) {
      if (item.format !== "Flakon") return null; // CRITICAL: only for Flakons
      const current = fillLevels[item.id] ?? null;

      return (
        <div style={{ marginBottom: 16 }}>
          <div style={S.lbl}>FÜLLSTAND</div>
          <div style={{ display: "flex", gap: 6 }}>
            {FILL_LEVELS.map(level => {
              const active = current === level;
              const color = FILL_COLORS[level];
              return (
                <button key={level} onClick={() => onSetFill(item.id, active ? null : level)}
                  title={FILL_LABELS[level]}
                  style={{
                    flex: 1, padding: "8px 4px", borderRadius: 8, border: `1px solid ${active ? color : "#E8E6E0"}`,
                    background: active ? color + "22" : "transparent", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 2
                  }}>
                  <div style={{
                    width: "100%", height: 28, background: "#F1EFE8", borderRadius: 4,
                    overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end"
                  }}>
                    <div style={{
                      width: "100%", height: `${level}%`, background: active ? color : color + "55",
                      transition: "height .3s"
                    }} />
                  </div>
                  <div style={{ fontSize: 9, color: active ? color : "#888780" }}>{FILL_LABELS[level]}</div>
                </button>
              );
            })}
          </div>
          {current !== null && current <= 25 && (
            <div style={{ fontSize: 11, color: "#E24B4A", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
              <span>◎</span>
              <span>{current === 0 ? "Leer – evtl. nachfüllen oder ersetzen" : "Fast leer – bald aufbrauchen oder ersetzen"}</span>
            </div>
          )}
        </div>
      );
    }

    function FillLevelBadge({ fillLevel }) {
      if (fillLevel === null || fillLevel === undefined) return null;
      const color = FILL_COLORS[fillLevel] || "#888";
      return (
        <div title={`Füllstand: ${FILL_LABELS[fillLevel]}`}
          style={{
            width: 16, height: 20, borderRadius: 3, border: `1px solid ${color}`,
            overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end"
          }}>
          <div style={{ width: "100%", height: `${fillLevel}%`, background: color }} />
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: DUFT-DNA RADAR CHART (SVG, kein externes Chart-Lib)
    // ══════════════════════════════════════════════════════════════════════════════
    const DNA_DIMS = [
      { id: "holzig",       label: "Holzig",    color: "#BA7517", notes: ["sandelholz", "zedernholz", "vetiver", "patschuli", "holz", "oud", "leder", "guaiac", "teak", "kastanie"] },
      { id: "suess",        label: "Süß",       color: "#D4537E", notes: ["vanille", "tonkabohne", "karamell", "honig", "benzoe", "heliotrop", "praline", "marshmallow", "schokolade", "karamell"] },
      { id: "frisch",       label: "Frisch",    color: "#1D9E75", notes: ["bergamotte", "zitrone", "grapefruit", "neroli", "minze", "petitgrain", "limette", "orange", "yuzu", "pomelo"] },
      { id: "orientalisch", label: "Oriental",  color: "#993C1D", notes: ["safran", "weihrauch", "oud", "zimt", "nelke", "rum", "tabak", "tonka", "kardamom", "muskat"] },
      { id: "wuerzig",      label: "Würzig",    color: "#534AB7", notes: ["pfeffer", "ingwer", "kardamom", "kümmel", "muskatnuss", "thymian", "koriander", "rosa pfeffer", "sternanis"] },
      { id: "gruen",        label: "Grün",      color: "#3B6D11", notes: ["gras", "basilikum", "veilchen", "iris", "tee", "kräuter", "farn", "eichenmoos", "galbanum", "bambus"] },
      { id: "aquatisch",    label: "Aquatisch", color: "#185FA5", notes: ["meer", "ozean", "wasser", "alge", "salz", "regen", "calone", "lotus", "seegras", "marin"] },
      { id: "floral",       label: "Floral",    color: "#E075A0", notes: ["rose", "jasmin", "ylang", "maiglöckchen", "lilie", "pfingstrose", "tuberose", "freesie", "neroli", "gardenie", "lavendel"] },
      { id: "gourmand",     label: "Gourmand",  color: "#C2604A", notes: ["kokos", "kaffe", "kakao", "mandel", "sahne", "milch", "butter", "kirsche", "beere", "mango", "pfirsich"] },
      { id: "harzig",       label: "Harzig",    color: "#8B5E3C", notes: ["labdanum", "benzoe", "opoponax", "elemi", "copaiba", "mastix", "peru balsam", "tolu balsam", "amber", "ambra", "ambergris", "styrax", "myrrhe"] },
      { id: "pudrig",       label: "Pudrig",    color: "#C4A0B0", notes: ["iris", "puder", "veilchen", "heliotrop", "lippenstift", "kosmetisch", "mimose", "amber"] },
      { id: "zitrisch",     label: "Zitrisch",  color: "#C9A825", notes: ["zitrone", "bergamotte", "orange", "limette", "grapefruit", "mandarine", "neroli", "petitgrain", "yuzu", "kumquat"] },
      { id: "animalisch",   label: "Animalisch",color: "#8B4513", notes: ["civette", "castoreum", "hyraceum", "moschus noir", "animalisch", "musc animal", "zibeth"] },
      { id: "rauchig",      label: "Rauchig",   color: "#5F5E5A", notes: ["tabak", "rauch", "birke", "guaiac", "vetiver", "incense", "teer", "kohle", "kreosot"] },
      { id: "ledrig",       label: "Ledrig",    color: "#7B4F3A", notes: ["leder", "cuir", "birke", "castoreum", "aldehyd", "isoeugenol", "benzyl benzoat", "labdanum", "suede", "wildleder"] },
    ];

    function computeDNA(items, log, weightByUsage = false) {
      const wc = {};
      if (weightByUsage) log.forEach(l => { wc[l.id] = (wc[l.id] || 0) + 1; });

      const scores = {};
      DNA_DIMS.forEach(d => { scores[d.id] = 0; });
      let itemWeightSum = 0;

      items.forEach(p => {
        const w = weightByUsage ? (wc[p.id] || 0) + 1 : 1;
        itemWeightSum += w;
        const allNotes = [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
          .map(n => n.toLowerCase().trim());
        DNA_DIMS.forEach(dim => {
          const matches = allNotes.filter(n => dim.notes.some(k => n.includes(k) || k.includes(n))).length;
          if (matches) scores[dim.id] += matches * w;
        });
      });

      if (!itemWeightSum) return DNA_DIMS.map(d => ({ ...d, value: 0 }));
      // Summe aller Dimensions-Scores (Noten können mehreren Kategorien zählen, z. B. Oud → holzig + orientalisch)
      const sumScores = DNA_DIMS.reduce((s, d) => s + scores[d.id], 0);
      if (sumScores <= 0) return DNA_DIMS.map(d => ({ ...d, value: 0 }));
      // Anteil jeder Dimension an der Gesamt-Trefferzahl → Werte summieren sich zu 1 (Radar = Mischungsverhältnis)
      return DNA_DIMS.map(d => ({ ...d, value: scores[d.id] / sumScores }));
    }

    // ── DuftDNAChart v3 – Chart.js Radar (via CDN) ──────────────────────────────
    // Interaktiv: Hover-Tooltip, alle 15 Familien-Achsen, passendes Farbschema.
    // Fallback: Wenn Chart.js nicht geladen, zeigt SVG-Fallback.
    // ─────────────────────────────────────────────────────────────────────────────
    function DuftDNAChart({ dna }) {
      const canvasRef = useRef(null);
      const chartRef = useRef(null);
      const [hoveredIdx, setHoveredIdx] = useState(null);

      const allZero = !dna || dna.every(d => d.value === 0);

      // Build chart data
      const labels = dna ? dna.map(d => d.label) : [];
      const values = dna ? dna.map(d => Math.round(d.value * 100)) : [];
      const colors = dna ? dna.map(d => d.color) : [];
      const dominant = dna ? [...dna].sort((a, b) => b.value - a.value)[0] : null;
      const maxVal = dna ? Math.max(...dna.map(d => d.value), 1e-12) : 1;

      useEffect(() => {
        if (allZero || !canvasRef.current) return;
        // Destroy previous chart instance if it exists
        if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

        // Check if Chart.js is available
        if (typeof Chart === "undefined") return;

        const ctx = canvasRef.current.getContext("2d");

        // Gradient fill using dominant color
        const dominantColor = dominant ? dominant.color : "#534AB7";

        chartRef.current = new Chart(ctx, {
          type: "radar",
          data: {
            labels,
            datasets: [{
              label: "Duft-DNA",
              data: values,
              backgroundColor: dominantColor + "28",
              borderColor: dominantColor,
              borderWidth: 2,
              pointBackgroundColor: colors,
              pointBorderColor: "#fff",
              pointBorderWidth: 1.5,
              pointRadius: values.map(v => v >= 1 ? 4 : 2),
              pointHoverRadius: 7,
              pointHoverBackgroundColor: colors,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: { duration: 500, easing: "easeInOutQuart" },
            scales: {
              r: {
                beginAtZero: true,
                max: Math.round(maxVal * 100) + 5,
                ticks: {
                  display: false,
                  stepSize: Math.round(maxVal * 25),
                },
                grid: { color: "#ECEAE4" },
                angleLines: {
                  color: ctx => {
                    // Color each axis line with the matching family color
                    return "#D3D1C744";
                  }
                },
                pointLabels: {
                  font: { size: 10, family: "'Georgia', serif" },
                  color: (ctx) => colors[ctx.index] || "#888780",
                  callback: (label, idx) => {
                    const v = values[idx] || 0;
                    return v >= 1 ? `${label} ${v}%` : label;
                  }
                },
              }
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const v = ctx.parsed.r;
                    return `${ctx.label}: ${v}%`;
                  }
                },
                backgroundColor: "#1A1A18",
                titleColor: "#fff",
                bodyColor: "#fff",
                cornerRadius: 8,
                padding: 10,
                titleFont: { family: "'Georgia', serif" },
                bodyFont: { family: "'Georgia', serif" },
              }
            },
            interaction: { mode: "index" }
          }
        });

        return () => {
          if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
        };
      }, [dna]);

      if (allZero) return (
        <div style={{ textAlign: "center", color: "#888780", padding: "28px 0", fontSize: 12, lineHeight: 1.6 }}>
          Keine Noten-Daten verfügbar.<br />
          <span style={{ fontSize: 11 }}>Füge Noten zu deinen Parfüms hinzu, um die DNA zu sehen.</span>
        </div>
      );

      // Fallback if Chart.js not loaded
      if (typeof Chart === "undefined") {
        return (
          <div style={{ textAlign: "center", color: "#888780", padding: "16px 0", fontSize: 12 }}>
            Chart.js wird geladen…
          </div>
        );
      }

      const sorted = dna ? [...dna].sort((a, b) => b.value - a.value) : [];

      return (
        <div style={{ userSelect: "none" }}>
          <div style={{ position: "relative", maxWidth: 320, margin: "0 auto" }}>
            <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "auto" }} />
          </div>

          {/* Legende: Top 8 als horizontale Bars */}
          <div style={{ marginTop: 12, padding: "0 4px" }}>
            {sorted.filter(d => d.value >= 0.01).slice(0, 8).map((d, i) => (
              <div key={d.id} style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 5,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#1A1A18", minWidth: 68 }}>{d.label}</span>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: "#ECEAE4", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    width: `${Math.round(d.value / maxVal * 100)}%`,
                    background: d.color,
                    transition: "width .4s ease-out",
                  }} />
                </div>
                <span style={{ fontSize: 10, color: d.color, fontWeight: 600, minWidth: 30, textAlign: "right" }}>
                  {Math.round(d.value * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    // ── DuftDNASection ────────────────────────────────────────────────────────────
    // BUGFIX: War nie definiert → React-Laufzeitfehler im Profil-Tab.
    // Wrapping-Komponente mit Sammlung/Nutzung-Toggle für DuftDNAChart.
    // ─────────────────────────────────────────────────────────────────────────────
    function DuftDNASection({ items, log }) {
      const [weighted, setWeighted] = useState(false);
      // EDGE CASE: leere items/log → computeDNA gibt value:0 zurück → Chart zeigt Leer-Hinweis
      const dna = useMemo(() => computeDNA(items, log, weighted), [items, log, weighted]);
      return (
        <div style={{ ...S.card, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={S.lbl}>DUFT-DNA RADAR</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setWeighted(false)}
                style={{ ...S.chip(!weighted, "#1A1A18"), fontSize: 10, padding: "4px 10px", transition: "all .2s" }}>
                Sammlung
              </button>
              <button type="button" onClick={() => setWeighted(true)}
                style={{ ...S.chip(weighted, "#1A1A18"), fontSize: 10, padding: "4px 10px", transition: "all .2s" }}>
                Nutzung
              </button>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#888780", marginBottom: 12, lineHeight: 1.45 }}>
            Prozent = Anteil an allen Duft-DNA-Treffern (Summe der Achsen ≈ 100&nbsp;%).
            Die Grafik skaliert auf die stärkste Achse, damit die Form den Rahmen ausfüllt.
            Eine Note kann in mehreren Kategorien zählen (z.&nbsp;B. Oud → holzig und orientalisch).
          </div>
          <DuftDNAChart dna={dna} />
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: DECLUTTER MODUS
    // ══════════════════════════════════════════════════════════════════════════════
    const DECLUTTER_DAYS = 180;
    // Neue Parfums erst nach X Tagen im Vergessen-Tab anzeigen (frisch hinzugefügt sollen dort nicht sofort auftauchen)
    const FORGOTTEN_NEW_DELAY_DAYS = 7;
    function getDeclutterSuggestions(items, log) {
      const now = Date.now();
      const wears = {};
      log.forEach(l => { if (!wears[l.id] || l.ts > wears[l.id]) wears[l.id] = l.ts; });
      return items.map(p => {
        // Neue Parfums ausblenden: erst nach FORGOTTEN_NEW_DELAY_DAYS Tagen
        if (p.addedAt && (now - p.addedAt) < FORGOTTEN_NEW_DELAY_DAYS * 86400000) return null;
        const lastTs = wears[p.id];
        const daysSince = lastTs ? (now - lastTs) / 86400000 : Infinity;
        const neverWorn = !lastTs;
        if (daysSince < DECLUTTER_DAYS && !neverWorn) return null;
        let suggestion = "Behalten", color = "#1D9E75", reason = "";
        if (neverWorn) {
          suggestion = "Ausprobieren"; color = "#BA7517";
          reason = "Noch nie getragen – vielleicht mal eine Chance geben?";
        } else if (daysSince > 365) {
          suggestion = "Verschenken"; color = "#993C1D";
          reason = `Seit ${Math.round(daysSince / 30)} Monaten nicht getragen.`;
        } else {
          suggestion = "Verkaufen"; color = "#534AB7";
          reason = `Seit ${Math.round(daysSince)} Tagen nicht getragen.`;
        }
        return { ...p, _days: Math.round(daysSince), _suggestion: suggestion, _reason: reason, _color: color };
      }).filter(Boolean).sort((a, b) => b._days - a._days);
    }

    function DeclutterTab({ items, log, onDelete, onSelectPerfume, onUpdate }) {
      const [filter, setFilter] = useState("all");
      const [dismissed, setDismissed] = useState(new Set());
      const [declDisplayCount, setDeclDisplayCount] = useState(15);
      // Persistent user decisions: { [id]: "Behalten"|"Verkaufen"|"Verschenken"|"Entfernt" }
      const [decisions, setDecisions] = useState(() => {
        try { return JSON.parse(localStorage.getItem(KEYS.declutterStatus) || "{}"); } catch { return {}; }
      });
      const [toast, setToast] = useState("");

      function saveDecision(id, decision) {
        setDecisions(prev => {
          const next = { ...prev, [id]: decision };
          try { localStorage.setItem(KEYS.declutterStatus, JSON.stringify(next)); } catch {}
          return next;
        });
      }
      function showToast(msg) {
        setToast(msg);
        setTimeout(() => setToast(""), 2200);
      }

      const suggestions = useMemo(() => getDeclutterSuggestions(items, log), [items, log]);
      // Items not yet "Behalten"-dismissed (dismissed = hidden from view entirely)
      const active = suggestions.filter(p => !dismissed.has(p.id));

      const visible = active.filter(p => {
        const dec = decisions[p.id];
        if (filter === "all") return true;
        if (filter === "Behalten") return dec === "Behalten";
        if (filter === "Verkaufen") return dec === "Verkaufen" || (!dec && p._suggestion === "Verkaufen");
        if (filter === "Verschenken") return dec === "Verschenken" || (!dec && p._suggestion === "Verschenken");
        if (filter === "Ausprobieren") return !dec && p._suggestion === "Ausprobieren";
        return true;
      });

      useEffect(() => { setDeclDisplayCount(15); }, [filter]);

      const counts = useMemo(() => {
        const c = { Ausprobieren: 0, Verkaufen: 0, Verschenken: 0, Behalten: 0 };
        active.forEach(p => {
          const dec = decisions[p.id];
          if (dec === "Behalten") c.Behalten++;
          else if (dec === "Verkaufen") c.Verkaufen++;
          else if (dec === "Verschenken") c.Verschenken++;
          else c[p._suggestion] = (c[p._suggestion] || 0) + 1;
        });
        return c;
      }, [active, decisions]);

      // Category button config
      const CATS = [
        { id: "Behalten",    icon: "🏠", color: "#1D9E75" },
        { id: "Verkaufen",   icon: "💰", color: "#534AB7" },
        { id: "Verschenken", icon: "🎁", color: "#993C1D" },
      ];

      function handleCategoryChange(p, newCat) {
        if (newCat === "Behalten") {
          // Behalten → dismiss from view
          setDismissed(prev => new Set([...prev, p.id]));
          showToast(`„${p.name}" als Behalten markiert`);
        } else {
          saveDecision(p.id, newCat);
          showToast(`„${p.name}" → ${newCat === "Verkaufen" ? "💰 Verkaufen" : "🎁 Verschenken"}`);
        }
      }

      return (
        <div>
          {/* Toast */}
          {toast && (
            <div style={{
              position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
              background: "#1A1A18", color: "#fff", padding: "10px 20px", borderRadius: 20,
              fontSize: 12, zIndex: 9999, animation: "fadeIn .2s ease-out", whiteSpace: "nowrap",
              boxShadow: "0 4px 20px rgba(26,26,24,.25)"
            }}>{toast}</div>
          )}

          <div style={{ ...S.card, background: "#F9F8F5", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Sammlung aufräumen</div>
            <div style={{ fontSize: 11, color: "#888780", lineHeight: 1.6 }}>
              Parfüms die du seit {DECLUTTER_DAYS} Tagen nicht getragen hast. Neu hinzugefügte Parfüms erscheinen erst nach {FORGOTTEN_NEW_DELAY_DAYS} Tagen.
              Markiere sie als 🏠 Behalten, 💰 Verkaufen oder 🎁 Verschenken.
            </div>
          </div>

          {/* Summary row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
            {[["Ausprobieren", "#BA7517"], ["Verkaufen", "#534AB7"], ["Verschenken", "#993C1D"], ["Behalten", "#1D9E75"]].map(([l, c]) => (
              <button key={l} onClick={() => setFilter(filter === l ? "all" : l)}
                style={{
                  ...S.card, marginBottom: 0, padding: "8px 4px", textAlign: "center",
                  border: `1px solid ${filter === l ? c : "#E8E6E0"}`, cursor: "pointer",
                  background: filter === l ? c + "11" : "#fff"
                }}>
                <div style={{ fontSize: 16, fontWeight: 400, color: c }}>{counts[l] || 0}</div>
                <div style={{ fontSize: 8, color: c, letterSpacing: "0.2px" }}>{l.toUpperCase()}</div>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div style={{ textAlign: "center", color: "#888780", padding: "40px 0", fontSize: 13 }}>
              {suggestions.length === 0
                ? "Alles bestens – alle Parfüms wurden kürzlich getragen! ✓"
                : "Alle Vorschläge abgearbeitet ✓"}
            </div>
          ) : visible.slice(0, declDisplayCount).map(p => {
            const userDec = decisions[p.id];
            const effectiveColor = userDec === "Behalten" ? "#1D9E75"
              : userDec === "Verkaufen" ? "#534AB7"
              : userDec === "Verschenken" ? "#993C1D"
              : p._color;
            const effectiveLabel = userDec || p._suggestion;
            return (
              <div key={p.id} style={{
                ...S.card, padding: "12px 14px", marginBottom: 8,
                borderLeft: `3px solid ${effectiveColor}`,
                transition: "all .4s cubic-bezier(0.25,.46,.45,.94)", transform: "translateY(0)",
                boxShadow: "0 1px 3px rgba(26,26,24,0.04)"
              }}
                onMouseEnter={function (e) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(26,26,24,0.08)" }}
                onMouseLeave={function (e) { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(26,26,24,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 14, fontFamily: "inherit", color: "inherit", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", width: "100%" }}>{p.name}</button>
                    <div style={{ fontSize: 11, color: "#888780" }}>{p.house} · {p.format}</div>
                  </div>
                  <span style={{ ...S.pill(effectiveColor), fontSize: 10, flexShrink: 0, marginLeft: 8 }}>{effectiveLabel}</span>
                </div>
                <div style={{ fontSize: 11, color: "#888780", marginBottom: 10, fontStyle: "italic" }}>{p._reason}</div>

                {/* Category buttons */}
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {CATS.map(cat => {
                    const isActive = userDec === cat.id || (!userDec && p._suggestion === cat.id && cat.id !== "Behalten");
                    return (
                      <button key={cat.id} onClick={() => handleCategoryChange(p, cat.id)}
                        style={{
                          flex: 1, padding: "7px 4px", borderRadius: 8, cursor: "pointer",
                          border: `1px solid ${isActive ? cat.color : "#E8E6E0"}`,
                          background: isActive ? cat.color + "18" : "transparent",
                          fontSize: 10, color: isActive ? cat.color : "#888780",
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                          transition: "all .2s", fontFamily: "'Georgia',serif"
                        }}>
                        <span style={{ fontSize: 14 }}>{cat.icon}</span>
                        <span>{cat.id}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Remove button */}
                {p._suggestion !== "Ausprobieren" && (
                  <button onClick={() => { if (confirm(`"${p.name}" wirklich entfernen?`)) { onDelete(p.id); saveDecision(p.id, "Entfernt"); } }}
                    style={{ ...S.btn("out"), fontSize: 11, padding: "6px 10px", width: "100%", color: "#E24B4A", borderColor: "#F09595" }}>
                    Aus Sammlung entfernen
                  </button>
                )}
                {p._suggestion === "Ausprobieren" && (
                  <div style={{ fontSize: 10, color: "#888780", textAlign: "center" }}>
                    Trag es heute! · <button onClick={() => { setDismissed(prev => new Set([...prev, p.id])); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", fontFamily: "inherit", textDecoration: "underline" }}>Ausblenden</button>
                  </div>
                )}
              </div>
            );
          })}
          {visible.length > declDisplayCount && (
            <button onClick={() => setDeclDisplayCount(c => c + 15)}
              style={{ ...S.btn("out"), width: "100%", fontSize: 12, padding: "12px", marginBottom: 8 }}>
              Mehr anzeigen ({visible.length - declDisplayCount} weitere)
            </button>
          )}
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: ONBOARDING
    // ══════════════════════════════════════════════════════════════════════════════
    const ONBOARD_STYLES = [
      { id: "fresh", label: "Frisch & Sauber", icon: "◎", family: "Fresh" },
      { id: "woody", label: "Holzig & Warm", icon: "◈", family: "Woody" },
      { id: "sweet", label: "Süß & Weich", icon: "◇", family: "Gourmand" },
      { id: "oriental", label: "Orientalisch", icon: "◆", family: "Oriental" },
      { id: "floral", label: "Blumig", icon: "♥", family: "Floral" },
      { id: "chypre", label: "Chypre & Moosig", icon: "★", family: "Chypre" },
    ];
    // 14 Duftfamilien für Onboarding-Auswahl
    const ONBOARD_FAMILIES = [
      { id: "Fresh",      label: "Frisch",        icon: "🍋" },
      { id: "Floral",     label: "Blumig",        icon: "🌸" },
      { id: "Woody",      label: "Holzig",        icon: "🌲" },
      { id: "Oriental",   label: "Orientalisch",  icon: "🌙" },
      { id: "Chypre",     label: "Chypre",        icon: "🌿" },
      { id: "Fougère",    label: "Fougère",       icon: "🪨" },
      { id: "Gourmand",   label: "Gourmand",      icon: "🍮" },
      { id: "Aquatisch",  label: "Aquatisch",     icon: "🌊" },
      { id: "Würzig",     label: "Würzig",        icon: "🌶️" },
      { id: "Harzig",     label: "Harzig",        icon: "🪵" },
      { id: "Ledrig",     label: "Ledrig",        icon: "🧥" },
      { id: "Grün",       label: "Grün",          icon: "🍃" },
      { id: "Fruchtig",   label: "Fruchtig",      icon: "🍑" },
      { id: "Pudrig",     label: "Pudrig",        icon: "🌫️" },
      { id: "Rauchig",    label: "Rauchig",       icon: "🔥" },
    ];
    const ONBOARD_OCC = [
      { id: "casual", label: "Alltag" }, { id: "work", label: "Büro" },
      { id: "evening", label: "Abend" }, { id: "date", label: "Date" },
      { id: "sport", label: "Sport" }, { id: "outdoor", label: "Outdoor" },
    ];

    // iOS Body-Scroll-Lock: verhindert dass der Hintergrund scrollt wenn Modal offen
    function useBodyLock(active) {
      React.useEffect(() => {
        if (!active) return;
        const scrollY = window.scrollY;
        document.body.classList.add("modal-open");
        document.body.style.top = "-" + scrollY + "px";
        return () => {
          document.body.classList.remove("modal-open");
          document.body.style.top = "";
          window.scrollTo(0, scrollY);
        };
      }, [active]);
    }

    function OnboardingModal({ onComplete }) {
      const [step, setStep] = useState(0);
      useBodyLock(true);
      const [styles, setStyles] = useState([]);
      const [favFamilies, setFavFamilies] = useState([]);
      const [occs, setOccs] = useState([]);

      function toggle(arr, setArr, val) {
        setArr(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
      }

      const steps = [
        {
          title: "Welche Düfte magst du?",
          sub: "Wähle deinen Duftstil – mehrere möglich.",
          body: (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {ONBOARD_STYLES.map(s => (
                <button key={s.id} onClick={() => toggle(styles, setStyles, s.id)}
                  style={{
                    ...S.chip(styles.includes(s.id)), padding: "12px", borderRadius: 10,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center"
                  }}>
                  <span style={{ fontSize: 20 }}>{s.icon}</span>
                  <span style={{ fontSize: 12 }}>{s.label}</span>
                </button>
              ))}
            </div>
          ),
        },
        {
          title: "Lieblingsduftfamilien",
          sub: "Welche Duftfamilien liebst du? (mehrere möglich)",
          body: (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 7 }}>
              {ONBOARD_FAMILIES.map(f => (
                <button key={f.id} onClick={() => toggle(favFamilies, setFavFamilies, f.id)}
                  style={{
                    ...S.chip(favFamilies.includes(f.id), "#534AB7"), padding: "10px 12px", borderRadius: 10,
                    display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontSize: 12
                  }}>
                  <span style={{ fontSize: 18 }}>{f.icon}</span>
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          ),
        },
        {
          title: "Hauptanlässe",
          sub: "Wofür trägst du Parfüm meistens?",
          body: (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {ONBOARD_OCC.map(o => (
                <button key={o.id} onClick={() => toggle(occs, setOccs, o.id)}
                  style={{
                    ...S.chip(occs.includes(o.id)), padding: "10px", borderRadius: 8,
                    textAlign: "center", fontSize: 12
                  }}>
                  {o.label}
                </button>
              ))}
            </div>
          ),
        },
      ];

      return (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 10000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          animation: "fadeIn .3s ease-out"
        }}>
          <div style={{
            background: "#FAFAF8", borderRadius: 16, padding: 24,
            maxWidth: 440, width: "100%", maxHeight: "85dvh", overflowY: "auto", WebkitOverflowScrolling: "touch",
            animation: "fadeIn .4s ease-out", transform: "scale(1)"
          }}>
            {/* Progress */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
              {steps.map((_, i) => (
                <div key={i} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: i <= step ? "#1A1A18" : "#E8E6E0"
                }} />
              ))}
            </div>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{steps[step].title}</div>
            <div style={{ fontSize: 12, color: "#888780", marginBottom: 16 }}>{steps[step].sub}</div>
            {steps[step].body}
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              {step > 0 && (
                <button onClick={() => setStep(s => s - 1)} style={{
                  ...S.btn("out"), flex: 1,
                  transition: "all .3s cubic-bezier(0.25,.46,.45,.94)"
                }}>Zurück</button>
              )}
              {step < steps.length - 1 ? (
                <button onClick={() => setStep(s => s + 1)} style={{
                  ...S.btn("pri"), flex: 2,
                  transition: "all .3s cubic-bezier(0.25,.46,.45,.94)"
                }}>Weiter</button>
              ) : (
                <button onClick={() => onComplete({ styles, favFamilies, occasions: occs })}
                  style={{
                    ...S.btn("pri"), flex: 2,
                    transition: "all .3s cubic-bezier(0.25,.46,.45,.94)"
                  }}>Fertig →</button>
              )}
            </div>
            <button onClick={() => onComplete(null)}
              style={{
                display: "block", width: "100%", textAlign: "center", fontSize: 11,
                color: "#B4B2A9", background: "none", border: "none", cursor: "pointer", marginTop: 12,
                transition: "color .2s"
              }}
              onMouseEnter={function (e) { e.currentTarget.style.color = "#534AB7" }}
              onMouseLeave={function (e) { e.currentTarget.style.color = "#B4B2A9" }}>
              Überspringen
            </button>
          </div>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: LAYERING EMPFEHLUNGEN
    // ══════════════════════════════════════════════════════════════════════════════
    // Layering-Kompatibilität: basiert auf Parfümerie-Theorie (Duftpyramide, Akkord-Harmonie)
    // Prinzip: ähnliche Basisnoten binden gut; Kontrast in Kopfnoten erzeugt Interesse;
    // Sandelholz/Vetiver/Moschus als Basisnoten harmonieren mit fast allem.
    const LAYERING_COMPAT = {
      // Fresh-Familie: Zitrus, grüne Noten, Aldehydische Frische
      "Fresh+Fresh":      { score: .70, label: "Verstärkend",       desc: "Frische potenziert sich – ideal morgens. Zitrusbasen wie Bergamotte & Limette addieren sich gut." },
      "Fresh+Floral":     { score: .90, label: "Harmonisch",        desc: "Klassische Kombination: frische Akzente heben Blütennoten auf. Ideal: Zitrusoben + florale Basis." },
      "Fresh+Aquatisch":  { score: .95, label: "Sehr harmonisch",   desc: "Meeresbrise-Effekt – gemeinsame Noten (Ozon, Maiglöckchen, Melon) verstärken sich gegenseitig." },
      "Fresh+Chypre":     { score: .85, label: "Sehr harmonisch",   desc: "Bergamotte & Grapefruit über Moos/Eiche ist ein bewährter Klassiker (z.B. Eau Sauvage-Stil)." },
      "Fresh+Woody":      { score: .80, label: "Harmonisch",        desc: "Frische Kopfnoten über Zedernholz/Sandelholz: sauber, maskulin & natürlich." },
      "Fresh+Fougère":    { score: .88, label: "Sehr harmonisch",   desc: "Lavendel-Fougère profitiert von frischen Zitruskopfnoten – belebend & klar." },
      "Fresh+Gourmand":   { score: .60, label: "Kontrastierend",    desc: "Frisch-süß ist ein Kontrast: interessant, aber die süße Basis kann die Frische erdrücken." },
      "Fresh+Oriental":   { score: .50, label: "Mutig",             desc: "Großer Kontrast – leichte Frische vs. warme Tiefe. Funktioniert wenn die Basis Moschus teilt." },
      "Fresh+Würzig":     { score: .72, label: "Harmonisch",        desc: "Schwarzer Pfeffer oder Kardamom über frischen Noten: belebend & modern." },
      "Fresh+Grün":       { score: .92, label: "Sehr harmonisch",   desc: "Grüne (Galbanum, Veilchenblatt) und frische Zitrusnoten teilen denselben Charakter." },
      "Fresh+Zitrisch":   { score: .95, label: "Sehr harmonisch",   desc: "Fast identische Familien – Bergamotte, Limette, Grapefruit ergänzen sich nahezu perfekt." },
      // Floral-Familie: Rosen, Jasmin, Ylang, Iris
      "Floral+Floral":    { score: .72, label: "Verstärkend",       desc: "Blumenstrauß-Effekt: verschiedene Blüten wie Rose+Jasmin harmonieren dank gemeinsamer Indol-Basis." },
      "Floral+Oriental":  { score: .90, label: "Harmonisch",        desc: "Warm-romantisch: florale Herznoten über Ambra/Vanille-Basis – der Klassiker des Abendparfüms." },
      "Floral+Gourmand":  { score: .80, label: "Harmonisch",        desc: "Süß-blumig: Rosen- oder Maiglöckchennoten über Tonkabohne & Vanille – weiblich & sanft." },
      "Floral+Woody":     { score: .87, label: "Sehr harmonisch",   desc: "Natürlich ausgewogen: florale Transparenz über Zedernholz/Sandelholz erdet die Blüten elegant." },
      "Floral+Chypre":    { score: .92, label: "Sehr harmonisch",   desc: "Das klassische Chypre-Floral (Eiche+Rose+Bergamotte) ist eines der zeitlosesten Akkorde." },
      "Floral+Fougère":   { score: .78, label: "Harmonisch",        desc: "Lavendel-Fougère mit floralen Herznoten – feminin-frisch, ideal für Büro & Alltag." },
      "Floral+Aquatisch": { score: .85, label: "Sehr harmonisch",   desc: "Aquatisch-floral: Meeres-Noten heben weiße Blüten (Tuberose, Lys) auf, luftig & sauber." },
      "Floral+Würzig":    { score: .70, label: "Harmonisch",        desc: "Nelke, Zimt oder Ingwer über floraler Mitte – interessant wenn die Würze dezent bleibt." },
      "Floral+Grün":      { score: .82, label: "Sehr harmonisch",   desc: "Grüne Noten wie Veilchenblatt & Galbanum geben Blüten Frische und Natürlichkeit." },
      // Woody-Familie: Zedernholz, Sandelholz, Vetiver, Oud
      "Woody+Woody":      { score: .80, label: "Verstärkend",       desc: "Tiefer Waldcharakter: verschiedene Holzarten wie Sandelholz+Vetiver ergänzen sich harmonisch." },
      "Woody+Oriental":   { score: .90, label: "Harmonisch",        desc: "Warm & komplex: Ambra, Weihrauch und Oud über Holzbasis – tief, sinnlich & langlebig." },
      "Woody+Gourmand":   { score: .75, label: "Harmonisch",        desc: "Süß-holzig: Sandelholz & Vetiver tragen Vanille/Tonkabohne elegant und geben Tiefe." },
      "Woody+Chypre":     { score: .95, label: "Sehr harmonisch",   desc: "Holzig-Chypre ist ein Eckpfeiler der klassischen Parfümerie: Vetiver+Moos+Patchouli." },
      "Woody+Fougère":    { score: .88, label: "Sehr harmonisch",   desc: "Fougère-Basisnoten (Eichenmoos, Cumarin) und Holznoten teilen dieselbe erdige DNA." },
      "Woody+Würzig":     { score: .83, label: "Sehr harmonisch",   desc: "Würzig-holzig: Pfeffer, Safran oder Gewürznelke über Zedern-/Sandelholzbasis – markant & warm." },
      "Woody+Harzig":     { score: .88, label: "Sehr harmonisch",   desc: "Baumharze wie Benzoe & Weihrauch sitzen auf derselben Holzbasis – nahtlose Integration." },
      "Woody+Rauchig":    { score: .82, label: "Harmonisch",        desc: "Geräucherte Noten (Birkenholzteer, Räucherstäbchen) über Holzbasis: maskulin & mystisch." },
      "Woody+Animalisch": { score: .70, label: "Harmonisch",        desc: "Moschus & Ambra über Holzbasis ist ein Klassiker – warm, körpernah & sinnlich." },
      // Oriental-Familie: Ambra, Weihrauch, Vanille, Oud
      "Oriental+Oriental":{ score: .60, label: "Intensiv",          desc: "Sehr schwer & komplex – ähnliche Ambra/Vanille-Basen können sich gegenseitig verstärken oder überlagern." },
      "Oriental+Gourmand":{ score: .85, label: "Harmonisch",        desc: "Warm, sinnlich & süß: Ambra-Basis trägt Vanille & Karamell elegant – Abendduft-Klassiker." },
      "Oriental+Chypre":  { score: .80, label: "Harmonisch",        desc: "Orient-Chypre: Weihrauch/Ambra über Eichenmoos – komplex & vielschichtig." },
      "Oriental+Würzig":  { score: .88, label: "Sehr harmonisch",   desc: "Gewürze (Kardamom, Safran, Zimt) verstärken die warme Tiefe orientalischer Basen natürlich." },
      "Oriental+Harzig":  { score: .90, label: "Sehr harmonisch",   desc: "Weihrauch, Myrrhe & Benzoe gehören klassisch zur orientalischen Familie – perfekte Harmonie." },
      "Oriental+Rauchig": { score: .82, label: "Harmonisch",        desc: "Räuchernoten verleihen orientalischen Akkorden mystische Tiefe – an Oud-Kompositions angelehnt." },
      "Oriental+Animalisch":{ score:.78, label: "Harmonisch",       desc: "Moschus & Zibeth über Ambra-Basis ist ein uralter Akkord – warm, körpernah, sinnlich." },
      // Gourmand-Familie: Vanille, Tonkabohne, Karamell, Schokolade
      "Gourmand+Gourmand":{ score: .62, label: "Überwältigend",     desc: "Kann zu süß werden – unterschiedliche Kopfnoten (z.B. Kaffee + Vanille) helfen beim Differenzieren." },
      "Gourmand+Würzig":  { score: .80, label: "Harmonisch",        desc: "Zimt, Gewürznelke oder Ingwer über Vanille-Basis – weihnachtlich & wohlig." },
      "Gourmand+Harzig":  { score: .78, label: "Harmonisch",        desc: "Benzoe & Labdanum tragen süß-cremige Noten elegant und geben Tiefe ohne zusätzliche Süße." },
      // Aquatisch-Familie: Meeresluft, Ozon, Selagsalz
      "Aquatisch+Aquatisch":{ score:.72, label: "Verstärkend",      desc: "Salzig-ozean Noten addieren sich – gut wenn verschiedene Aspekte (Salz vs. grüne Algen) kombiniert werden." },
      "Aquatisch+Fresh":  { score: .95, label: "Sehr harmonisch",   desc: "Perfekte Sommerkombination – Ozonnoten und Zitrusfrische teilen denselben hellen Charakter." },
      "Aquatisch+Floral": { score: .85, label: "Sehr harmonisch",   desc: "Aquatisch-floral ist ein bewährtes Akkord-Paar: sauber, leicht, feminin." },
      "Aquatisch+Woody":  { score: .75, label: "Harmonisch",        desc: "Salzige Meeresluft über Treibholz/Zedernholz: küstennah & maskulin." },
      "Aquatisch+Chypre": { score: .82, label: "Sehr harmonisch",   desc: "Marine Chypres (Moos + Ozon) sind ein moderner Klassiker." },
      "Aquatisch+Fougère":{ score: .80, label: "Harmonisch",        desc: "Fougère mit aquatischen Akzenten – frisch, sauber, unisex." },
      // Chypre-Familie: Eichenmoos, Bergamotte, Labdanum
      "Chypre+Chypre":    { score: .75, label: "Verstärkend",       desc: "Verschiedene Chypre-Ausrichtungen (moosig vs. fruchtig) können sich sinnvoll schichten." },
      "Chypre+Oriental":  { score: .80, label: "Harmonisch",        desc: "Orientalisches Chypre: Labdanum-Basis verbindet beide Familien nahtlos." },
      "Chypre+Fougère":   { score: .85, label: "Sehr harmonisch",   desc: "Moos und Cumarin teilen eine erdige, ledrige DNA – klassisch maskulin." },
      "Chypre+Würzig":    { score: .78, label: "Harmonisch",        desc: "Gewürze geben Chypre-Akkorden Wärme und Komplexität ohne die Frische zu brechen." },
      "Chypre+Harzig":    { score: .82, label: "Sehr harmonisch",   desc: "Labdanum-Labdanum-Basis: Harzige Noten sitzen perfekt auf der Chypre-Grundstruktur." },
      // Fougère-Familie: Lavendel, Eichenmoos, Cumarin
      "Fougère+Fougère":  { score: .68, label: "Verstärkend",       desc: "Ähnliche Basen (Cumarin, Eichenmoos) können sich überlagern – unterschiedliche Kopfnoten wählen." },
      "Fougère+Würzig":   { score: .85, label: "Sehr harmonisch",   desc: "Lavendel + Gewürze (Pfeffer, Koriander) ist ein klassisches maskulines Akkord-Muster." },
      // Würzig-Familie
      "Würzig+Würzig":    { score: .65, label: "Intensiv",          desc: "Kann überwältigend werden – unterschiedliche Gewürze (Pfeffer vs. Kardamom) zusammenmischen." },
      "Würzig+Harzig":    { score: .82, label: "Sehr harmonisch",   desc: "Gewürze und Harze teilen eine warme, dichte Basis – ideal für Herbst/Winter." },
      "Würzig+Oriental":  { score: .88, label: "Sehr harmonisch",   desc: "Gewürze sind klassische Kopfnoten orientalischer Kompositionen – nahtlose Verbindung." },
      // Grün-Familie
      "Grün+Grün":        { score: .70, label: "Verstärkend",       desc: "Verschiedene Grünnoten (Galbanum vs. Veilchenblatt) addieren Tiefe und Natürlichkeit." },
      "Grün+Aquatisch":   { score: .82, label: "Sehr harmonisch",   desc: "Grün-aquatisch: Seegras, Algen-Noten und grüne Blätter passen natürlich zusammen." },
      "Grün+Chypre":      { score: .88, label: "Sehr harmonisch",   desc: "Grünes Chypre ist ein eigenes Subgenre – Galbanum über Moos ist ein Parfümklassiker." },
      // Animalisch-Familie
      "Animalisch+Woody": { score: .70, label: "Harmonisch",        desc: "Moschus & Zibet sitzen auf Holzbasen natürlich – warm, körpernah, sinnlich." },
      "Animalisch+Oriental":{ score:.78, label: "Harmonisch",       desc: "Animalische Noten (Bibergeil, Ambra) sind oft Grundbestandteil orientalischer Akkorde." },
      // Harzig-Familie
      "Harzig+Harzig":    { score: .72, label: "Verstärkend",       desc: "Verschiedene Harze (Benzoe, Weihrauch, Myrrhe) addieren Komplexität in der Basis." },
      "Harzig+Rauchig":   { score: .85, label: "Sehr harmonisch",   desc: "Weihrauch & Räuchernoten sind klassische Partner – religiös, mystisch, zeitlos." },
      // Rauchig-Familie
      "Rauchig+Oriental": { score: .82, label: "Harmonisch",        desc: "Räuchernoten verleihen orientalischen Akkorden mystische Tiefe (Oud-Stil)." },
      // Cremig-Familie
      "Cremig+Gourmand":  { score: .88, label: "Sehr harmonisch",   desc: "Sandelholz-Cremigkeit trägt Vanille & Karamell elegant – weich & warm." },
      "Cremig+Floral":    { score: .85, label: "Sehr harmonisch",   desc: "Cremige Sandelholz-Basis unter floralen Herznoten: pudrig-feminin & zeitlos." },
      "Cremig+Oriental":  { score: .83, label: "Sehr harmonisch",   desc: "Cremige Noten (Sandelholz, Kokosnuss) ergänzen orientalische Ambra-Basen harmonisch." },
      // Fruchtig-Familie
      "Fruchtig+Floral":  { score: .88, label: "Sehr harmonisch",   desc: "Fruchtblumig ist eines der beliebtesten modernen Akkord-Muster – feminin, frisch, fröhlich." },
      "Fruchtig+Gourmand":{ score: .80, label: "Harmonisch",        desc: "Fruchtige Noten (Pfirsich, Himbeere) ergänzen süße Vanille-Basen spielerisch." },
      "Fruchtig+Fresh":   { score: .85, label: "Sehr harmonisch",   desc: "Zitrusfrüchte & Beerenfrüchte teilen helle, klare Charakteristika – harmonisch & lebendig." },
      // Pudrig-Familie
      "Pudrig+Floral":    { score: .88, label: "Sehr harmonisch",   desc: "Pudriger Iris/Veilchen über Blütennoten – der Klassiker des Retro-Parfüms (Chanel N°5-Stil)." },
      "Pudrig+Oriental":  { score: .82, label: "Sehr harmonisch",   desc: "Ambra-Pudernoten über orientalischer Basis – warm, sinnlich, weiblich." },
      "Pudrig+Gourmand":  { score: .78, label: "Harmonisch",        desc: "Pudriger Vanille-Moschus über Gourmand-Basis: weich, schmeichelnd & langanhaltend." },
      // Zitrisch-Familie
      "Zitrisch+Fresh":   { score: .95, label: "Sehr harmonisch",   desc: "Fast identische Familien – Bergamotte, Zitrone, Grapefruit ergänzen sich perfekt." },
      "Zitrisch+Aquatisch":{ score:.88, label: "Sehr harmonisch",   desc: "Salzige Meeresluft + Zitrusnoten = frische Küstenatmosphäre." },
      "Zitrisch+Floral":  { score: .85, label: "Sehr harmonisch",   desc: "Zitrusfrische als Kopfnote über floraler Mitte ist ein bewährter Klassiker." },
      "Zitrisch+Fougère": { score: .88, label: "Sehr harmonisch",   desc: "Bergamotte & Lavendel bilden das Fundament klassischer Fougères (Brut, Azzaro)." },
      "Zitrisch+Chypre":  { score: .90, label: "Sehr harmonisch",   desc: "Bergamotte-Chypre-Akkord ist das Herzstück der Chypre-Familie – untrennbar verbunden." },
      // Erdig-Familie
      "Erdig+Woody":      { score: .90, label: "Sehr harmonisch",   desc: "Vetiver, Patchouli & Zedernholz teilen eine verwandte erdige DNA – nahtlos kombinierbar." },
      "Erdig+Chypre":     { score: .88, label: "Sehr harmonisch",   desc: "Erdige Noten (Patchouli, Moschus) sind Kernbestandteile der Chypre-Akkorde." },
      "Erdig+Oriental":   { score: .78, label: "Harmonisch",        desc: "Tiefes Patchouli über Ambra-Basis: schwer, sinnlich & komplex – für kühle Abende." },
      // Synthetisch-Familie (Ambroxan, ISO E Super etc.)
      "Synthetisch+Woody":{ score: .82, label: "Sehr harmonisch",   desc: "Molekulare Holznoten (Iso E Super, Ambroxan) harmonieren gut mit natürlichen Holzbasen." },
      "Synthetisch+Fresh":{ score: .80, label: "Harmonisch",        desc: "Synthetische Frische-Moleküle (Calone, Dihydromyrcenol) ergänzen frische Noten effektiv." },
      "Synthetisch+Aquatisch":{ score:.85, label: "Sehr harmonisch",desc: "Ozonnoten wie Calone wurden speziell für aquatische Akkorde entwickelt." },
    };

    function getLayerCompat(fam1, fam2) {
      const key1 = `${fam1}+${fam2}`;
      const key2 = `${fam2}+${fam1}`;
      return LAYERING_COMPAT[key1] || LAYERING_COMPAT[key2] ||
        { score: .5, label: "Experimentell", desc: "Ungewöhnliche Kombination – probier es aus!" };
    }

    function analyzeNoteCompat(p1, p2) {
      // Normalize a note string: lowercase + trim
      const norm = s => s.toLowerCase().trim();

      const top1    = splitNotes(p1.top).map(norm);
      const middle1 = splitNotes(p1.middle).map(norm);
      const base1   = splitNotes(p1.base).map(norm);
      const top2    = splitNotes(p2.top).map(norm);
      const middle2 = splitNotes(p2.middle).map(norm);
      const base2   = splitNotes(p2.base).map(norm);

      const allN1 = [...top1, ...middle1, ...base1];
      const allN2 = [...top2, ...middle2, ...base2];

      // Smarter note matching: exact match first; substring only when both sides are
      // meaningful (≥4 chars) to avoid "rose" matching "rosenholz" as a false positive.
      function notesMatch(a, b) {
        if (a === b) return true;
        if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
        return false;
      }

      // Shared notes: notes that appear in both perfumes (deduplicated)
      const shared = [];
      const usedN2 = new Set();
      for (const n of allN1) {
        const match = allN2.find((m, i) => !usedN2.has(i) && notesMatch(n, m));
        if (match !== undefined) {
          const idx = allN2.indexOf(match);
          usedN2.add(idx);
          if (!shared.some(s => notesMatch(s, n))) shared.push(n);
        }
      }

      // Bridge notes: the actual scent blend you smell when layering.
      // Correct model: P1 base + P2 top (P2 applied over drydown of P1)
      // AND P2 base + P1 top (reverse order) — shown as a unified pool so
      // the result is order-independent.
      const bridgePool = [...new Set([...base1, ...top2, ...base2, ...top1])]
        .filter(n => n.length > 0);

      // Prioritize bridge notes that are also shared (highest harmony signal)
      const bridgePrioritized = [
        ...bridgePool.filter(n => shared.some(s => notesMatch(s, n))),
        ...bridgePool.filter(n => !shared.some(s => notesMatch(s, n))),
      ].filter((n, i, a) => a.findIndex(m => notesMatch(n, m)) === i); // deduplicate

      const hasP1Notes = allN1.length > 0;
      const hasP2Notes = allN2.length > 0;

      return {
        shared,
        bridgeNotes: bridgePrioritized.slice(0, 6),
        hasP1Notes,
        hasP2Notes,
      };
    }

    function LayeringPerfumeSelect({ label, inputId, search, setSearch, filtered, selected, setSelected, items }) {
      const [open, setOpen] = useState(false);
      const selectedP = items.find(p => p.id === selected);
      const families = selectedP
        ? (selectedP.families && selectedP.families.length > 0 ? selectedP.families : [selectedP.family || "Sonstiges"])
        : [];
      return (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.lbl}>{label}</div>
          <div style={{ position: "relative" }}>
            <input id={inputId} value={selectedP ? `${selectedP.name} – ${selectedP.house}` : search}
              onChange={e => { setSearch(e.target.value); setOpen(true); if (selected) setSelected(""); }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Parfüm suchen…"
              style={{ ...S.inp, fontSize: 12 }} />
            {selectedP && (
              <button onClick={() => { setSelected(""); setSearch(""); }}
                aria-label="Auswahl zurücksetzen"
                style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#B4B2A9"
                }}>✕</button>
            )}
            {open && !selectedP && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
                background: "#fff", border: "1px solid #E8E6E0", borderRadius: 8,
                maxHeight: 180, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.1)"
              }}>
                {filtered.slice(0, 20).map(p => {
                  const pFams = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];
                  return (
                    <div key={p.id}
                      onMouseDown={e => { e.preventDefault(); setSelected(p.id); setSearch(""); setOpen(false); }}
                      style={{ padding: "8px 12px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #F1EFE8" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#F1EFE8"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div>{p.name}</div>
                      <div style={{ fontSize: 10, color: "#888780" }}>
                        {p.house} · {pFams.map((f, idx) => (
                          <span key={f} style={idx === 0 ? { fontWeight: 500 } : { fontWeight: 400, opacity: 0.7 }}>
                            {f}{idx < pFams.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "#888780" }}>Kein Treffer</div>}
              </div>
            )}
          </div>
        </div>
      );
    }

    // ── SMART MATCH: Beste Layering-Partner aus der Sammlung finden ──────────────
    // Algorithmus: rein faktenbasiert auf LAYERING_COMPAT (Duftfamilien-Theorie)
    // + Noten-Überlappung (geteilte Noten erhöhen Score). Keine KI-Spekulation.
    const KNOWN_FAMILIES = [
      "Fresh","Floral","Woody","Oriental","Gourmand","Aquatisch","Chypre",
      "Fougère","Würzig","Grün","Animalisch","Harzig","Rauchig","Cremig",
      "Fruchtig","Pudrig","Zitrisch","Erdig","Synthetisch"
    ];

    function detectFamiliesFromText(text) {
      const t = text.toLowerCase();
      const detected = [];
      const keywordMap = {
        "Fresh":      ["fresh","frisch","zitrus","citrus","bergamotte","limette","grapefruit"],
        "Floral":     ["floral","blumig","rose","jasmin","ylang","iris","maiglöckchen","blüte"],
        "Woody":      ["woody","holz","holzig","zedernholz","sandelholz","vetiver","oud","zedern"],
        "Oriental":   ["oriental","orientalisch","ambra","amber","weihrauch","vanille","oud"],
        "Gourmand":   ["gourmand","süß","vanilla","karamell","schokolade","tonkabohne"],
        "Aquatisch":  ["aqua","aquatisch","ozean","marine","meeresluft","ozon","salzig"],
        "Chypre":     ["chypre","eichenmoos","oakmoss","labdanum"],
        "Fougère":    ["fougère","fougere","lavendel","cumarin"],
        "Würzig":     ["würzig","spicy","pfeffer","kardamom","ingwer","zimt","safran","gewürz"],
        "Grün":       ["grün","green","galbanum","veilchenblatt","farn"],
        "Harzig":     ["harzig","harz","benzoe","myrrhe","weihrauch","olibanum"],
        "Rauchig":    ["rauchig","smoke","räucher","birkenholzteer","leder"],
        "Cremig":     ["cremig","cream","kokosnuss"],
        "Fruchtig":   ["fruchtig","fruit","pfirsich","himbeere","pflaume","apfel","birne"],
        "Pudrig":     ["pudrig","powdery","puder"],
        "Zitrisch":   ["zitrisch","zitrone","lemon"],
        "Erdig":      ["erdig","earth","patchouli","moos"],
        "Animalisch": ["animalisch","animal","moschus","musk","zibet","bibergeil"],
        "Synthetisch":["synthetisch","ambroxan","iso e super","calone","molekular"],
      };
      for (const [fam, kws] of Object.entries(keywordMap)) {
        if (kws.some(kw => t.includes(kw))) detected.push(fam);
      }
      return detected.length > 0 ? [...new Set(detected)] : ["Sonstiges"];
    }

    // NOTE_CAT_COMPAT: Welche Notenkategorien harmonieren beim Layering?
    // Basis: Parfümchemie & Akkord-Theorie – geteilte oder komplementäre Kategorien
    // ergeben harmonische Layers. Quelle: dieselbe Logik wie LAYERING_COMPAT-Tabelle.
    const NOTE_CAT_COMPAT = {
      // Eine Kategorie mit sich selbst (Verstärkung)
      "Süß+Süß":0.6, "Würzig+Würzig":0.6, "Harzig+Harzig":0.75, "Cremig+Cremig":0.7,
      "Zitrisch+Zitrisch":0.7, "Erdig+Erdig":0.7, "Rauchig+Rauchig":0.6,
      "Aquatisch+Aquatisch":0.7, "Floral+Floral":0.65, "Grün+Grün":0.7,
      // Klassische Harmonie-Paare (aus LAYERING_COMPAT ableitbar)
      "Süß+Cremig":0.92, "Süß+Harzig":0.80, "Süß+Würzig":0.82, "Süß+Erdig":0.65,
      "Würzig+Harzig":0.88, "Würzig+Erdig":0.80, "Würzig+Rauchig":0.82,
      "Würzig+Animalisch":0.75, "Würzig+Zitrisch":0.72,
      "Harzig+Rauchig":0.90, "Harzig+Erdig":0.82, "Harzig+Animalisch":0.78,
      "Harzig+Cremig":0.85,
      "Cremig+Floral":0.88, "Cremig+Pudrig":0.82,
      "Erdig+Rauchig":0.80, "Erdig+Animalisch":0.72, "Erdig+Grün":0.80,
      "Zitrisch+Aquatisch":0.90, "Zitrisch+Grün":0.88, "Zitrisch+Floral":0.85,
      "Zitrisch+Fougère":0.88, "Zitrisch+Fruchtig":0.80,
      "Aquatisch+Grün":0.85, "Aquatisch+Fougère":0.80, "Aquatisch+Floral":0.82,
      "Grün+Floral":0.85, "Grün+Fougère":0.82,
      "Floral+Pudrig":0.88, "Floral+Fruchtig":0.88, "Floral+Fougère":0.78,
      "Pudrig+Animalisch":0.78, "Pudrig+Cremig":0.82, "Pudrig+Süß":0.75,
      "Fruchtig+Süß":0.80, "Fruchtig+Floral":0.88,
      "Animalisch+Rauchig":0.75, "Fougère+Harzig":0.75,
    };
    function getNoteCatCompat(c1, c2) {
      if (!c1 || !c2) return 0.5;
      if (c1 === c2) return NOTE_CAT_COMPAT[`${c1}+${c1}`] || 0.65;
      return NOTE_CAT_COMPAT[`${c1}+${c2}`] || NOTE_CAT_COMPAT[`${c2}+${c1}`] || 0.5;
    }

    // Normalisiert eine Note für Vergleiche
    function normNote(s) {
      return stripDiacritics(String(s||"")).toLowerCase().trim();
    }
    function notesMatch(a, b) {
      const na = normNote(a), nb = normNote(b);
      if (na === nb) return true;
      if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
      return false;
    }

    // Hauptscore-Funktion – vollständig faktenbasiert
    // Gewichtung: 40% Familien-Kompatibilität + 35% Noten-Kategorien-Kompatibilität + 25% direkte Noten-Überlappung
    function computeSmartScore(inputFamilies, inputNotes, inputTop, inputMiddle, inputBase, collectionPerfume) {
      const n = s => normNote(s);

      // ── 1) FAMILIEN-KOMPATIBILITÄT (40%) ─────────────────────────────────────
      const collFams = (collectionPerfume.families && collectionPerfume.families.length > 0)
        ? collectionPerfume.families : [collectionPerfume.family || "Sonstiges"];
      let bestFamScore = 0;
      let bestCompat = null;
      for (const f1 of inputFamilies) {
        for (const f2 of collFams) {
          const c = getLayerCompat(f1, f2);
          if (c.score > bestFamScore) { bestFamScore = c.score; bestCompat = c; }
        }
      }

      // ── 2) NOTEN-KATEGORIEN-KOMPATIBILITÄT (35%) ─────────────────────────────
      // Welche Kategorien hat das Input-Parfum vs. das Sammlungs-Parfum?
      // Bridge-Logic: Input-Base ↔ Coll-Top ist die eigentliche Überlappungszone beim Layering
      const iTop    = (inputTop    ? splitNotes(inputTop)    : inputNotes.slice(0, Math.ceil(inputNotes.length/3))).map(n);
      const iMid    = (inputMiddle ? splitNotes(inputMiddle) : inputNotes.slice(Math.ceil(inputNotes.length/3), Math.ceil(2*inputNotes.length/3))).map(n);
      const iBase   = (inputBase   ? splitNotes(inputBase)   : inputNotes.slice(Math.ceil(2*inputNotes.length/3))).map(n);
      const cTop    = splitNotes(collectionPerfume.top).map(n);
      const cMid    = splitNotes(collectionPerfume.middle).map(n);
      const cBase   = splitNotes(collectionPerfume.base).map(n);

      // Kategorien für jede Zone bestimmen
      function zoneCats(notes) {
        const cats = new Set();
        notes.forEach(note => { const c = NOTE_TO_CAT[note]; if (c) cats.add(c); });
        return [...cats];
      }
      const iTopCats  = zoneCats(iTop);
      const iMidCats  = zoneCats(iMid);
      const iBaseCats = zoneCats(iBase);
      const cTopCats  = zoneCats(cTop);
      const cMidCats  = zoneCats(cMid);
      const cBaseCats = zoneCats(cBase);

      // Bridge-Pairs: iBase↔cTop (hauptsächlich) + iMid↔cMid + iTop↔cBase
      const bridgePairs = [
        { a: iBaseCats, b: cTopCats,  weight: 0.5 },  // Hauptbridge
        { a: iMidCats,  b: cMidCats,  weight: 0.3 },  // Herznoten
        { a: iTopCats,  b: cBaseCats, weight: 0.2 },  // Umgekehrt
      ];
      let catScore = 0;
      let catWeight = 0;
      for (const { a, b, weight } of bridgePairs) {
        if (a.length === 0 && b.length === 0) continue;
        if (a.length === 0 || b.length === 0) {
          catScore += 0.5 * weight; // Keine Daten → neutraler Score
          catWeight += weight;
          continue;
        }
        // Bestes Kategorien-Paar aus dieser Zone
        let bestPairScore = 0;
        for (const ca of a) for (const cb of b) {
          const s = getNoteCatCompat(ca, cb);
          if (s > bestPairScore) bestPairScore = s;
        }
        catScore += bestPairScore * weight;
        catWeight += weight;
      }
      const finalCatScore = catWeight > 0 ? catScore / catWeight : 0.5;

      // ── 3) DIREKTE NOTEN-ÜBERLAPPUNG (25%) ───────────────────────────────────
      // Shared Notes (identisch) geben hohen Score; Bridge-Notes (iBase↔cTop) extra
      const allInput  = [...iTop, ...iMid, ...iBase].filter(Boolean);
      const allColl   = [...cTop, ...cMid, ...cBase].filter(Boolean);

      // a) Shared notes (exakt/Substring)
      let sharedCount = 0;
      const usedColl = new Set();
      for (const ni of allInput) {
        for (let j = 0; j < allColl.length; j++) {
          if (!usedColl.has(j) && notesMatch(ni, allColl[j])) {
            sharedCount++;
            usedColl.add(j);
            break;
          }
        }
      }
      // b) Bridge overlap: Input-Base-Noten die in Coll-Top vorkommen
      let bridgeCount = 0;
      for (const nb of iBase) {
        if (cTop.some(ct => notesMatch(nb, ct))) bridgeCount++;
      }

      const maxPossible = Math.max(allInput.length, allColl.length, 1);
      const rawNoteScore = allInput.length === 0 || allColl.length === 0
        ? 0.5  // Keine Noten vorhanden → neutral
        : Math.min(1, (sharedCount / maxPossible) + (bridgeCount * 0.05));

      // ── GESAMTSCORE ──────────────────────────────────────────────────────────
      const W_FAM  = 0.40;
      const W_CAT  = 0.35;
      const W_NOTE = 0.25;
      // Wenn keine Noten-Daten vorhanden: Gewicht auf Familien verschieben
      const hasInputNotes = allInput.length > 0;
      const hasCollNotes  = allColl.length > 0;
      const effectiveWNote = (hasInputNotes && hasCollNotes) ? W_NOTE : 0;
      const effectiveWCat  = (hasInputNotes && hasCollNotes) ? W_CAT  : 0;
      const effectiveWFam  = 1 - effectiveWCat - effectiveWNote;

      const totalScore = (bestFamScore * effectiveWFam)
                       + (finalCatScore * effectiveWCat)
                       + (rawNoteScore  * effectiveWNote);

      return {
        score: Math.min(1, Math.max(0, totalScore)),
        compat: bestCompat || { score: 0.5, label: "Experimentell", desc: "Unbekannte Kombination." },
        collFams,
        sharedCount,
        bridgeCount,
        catScore: Math.round(finalCatScore * 100),
      };
    }

    function SmartMatchMode({ items }) {
      // Primär: Parfum aus Sammlung wählen (wie LayeringPerfumeSelect)
      const [selId, setSelId]             = useState("");
      const [search, setSearch]           = useState("");
      const [dropOpen, setDropOpen]       = useState(false);
      // Fallback: manuelle Familie + Noten (nur wenn kein Sammlung-Parfum gewählt)
      const [manualFamText, setManualFamText]   = useState("");
      const [manualNoteText, setManualNoteText] = useState("");
      const [showManual, setShowManual]         = useState(false);
      const [results, setResults]               = useState(null);

      const sorted = useMemo(() => [...items].sort((a,b) => a.name.localeCompare(b.name)), [items]);
      const selectedP = items.find(p => p.id === selId);

      const filtered = useMemo(() => sorted.filter(p =>
        !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.house||"").toLowerCase().includes(search.toLowerCase())
      ), [sorted, search]);

      function runSmartMatch() {
        let inputFamilies, inputTop, inputMiddle, inputBase;

        if (selectedP) {
          inputFamilies = (selectedP.families && selectedP.families.length > 0)
            ? selectedP.families : [selectedP.family || "Sonstiges"];
          inputTop    = selectedP.top    || "";
          inputMiddle = selectedP.middle || "";
          inputBase   = selectedP.base   || "";
          // Manuelle Ergänzungen
          if (manualFamText.trim()) {
            const extra = detectFamiliesFromText(manualFamText);
            inputFamilies = [...new Set([...inputFamilies, ...extra])];
          }
          if (manualNoteText.trim()) {
            // Zusätzliche manuelle Noten an die Base hängen
            inputBase = [inputBase, manualNoteText].filter(Boolean).join(", ");
          }
        } else {
          inputFamilies = detectFamiliesFromText(manualFamText + " " + manualNoteText);
          inputTop = ""; inputMiddle = ""; inputBase = manualNoteText;
        }

        const inputAllNotes = [
          ...splitNotes(inputTop), ...splitNotes(inputMiddle), ...splitNotes(inputBase)
        ];

        const scored = items
          .filter(p => !selectedP || p.id !== selectedP.id)
          .map(p => {
            const res = computeSmartScore(inputFamilies, inputAllNotes, inputTop, inputMiddle, inputBase, p);
            return { p, ...res };
          });
        scored.sort((a, b) => b.score - a.score);
        setResults({ inputFamilies, inputAllNotes, inputTop, inputMiddle, inputBase, scored });
      }

      const compatColor = s => s >= .8 ? "#1D9E75" : s >= .6 ? "#BA7517" : "#993C1D";
      const canSearch = selectedP || manualFamText.trim() || manualNoteText.trim();

      return (
        <div>
          <div style={{ ...S.card, background: "#F9F8F5", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Smart Match</div>
            <div style={{ fontSize: 11, color: "#888780", lineHeight: 1.6, marginBottom: 10 }}>
              Wähle ein Parfum – die App findet die besten Layer-Partner aus deiner Sammlung. Basiert auf Duftfamilien-Theorie &amp; Noten-Analyse.
            </div>

            {/* Parfum-Picker (aus der Sammlung) */}
            <div style={S.lbl}>PARFUM WÄHLEN</div>
            <div style={{ position: "relative", marginBottom: 10 }}>
              <input
                value={selectedP ? `${selectedP.name} – ${selectedP.house}` : search}
                onChange={e => { setSearch(e.target.value); setDropOpen(true); if (selId) setSelId(""); setResults(null); }}
                onFocus={() => setDropOpen(true)}
                onBlur={() => setTimeout(() => setDropOpen(false), 150)}
                placeholder="Parfum aus Sammlung suchen…"
                style={{ ...S.inp, fontSize: 12 }} />
              {selectedP && (
                <button onClick={() => { setSelId(""); setSearch(""); setResults(null); }}
                  aria-label="Auswahl zurücksetzen"
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#B4B2A9" }}>✕</button>
              )}
              {dropOpen && !selectedP && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
                  background: "#fff", border: "1px solid #E8E6E0", borderRadius: 8,
                  maxHeight: 200, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.1)"
                }}>
                  {filtered.slice(0, 25).map(p => {
                    const pFams = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];
                    return (
                      <div key={p.id}
                        onMouseDown={e => { e.preventDefault(); setSelId(p.id); setSearch(""); setDropOpen(false); setResults(null); }}
                        style={{ padding: "8px 12px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #F1EFE8" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#F1EFE8"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div>{p.name}</div>
                        <div style={{ fontSize: 10, color: "#888780" }}>
                          {p.house} · {pFams.map((f, i) => (
                            <span key={f} style={i === 0 ? { fontWeight: 500 } : { opacity: 0.7 }}>
                              {f}{i < pFams.length - 1 ? ", " : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "#888780" }}>Kein Treffer</div>}
                </div>
              )}
            </div>

            {/* Gewählte Familie anzeigen */}
            {selectedP && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                {((selectedP.families && selectedP.families.length > 0)
                  ? selectedP.families : [selectedP.family || "Sonstiges"]).map((f,i) => (
                  <span key={f} style={{ ...S.pill(FAM_COLORS[f] || "#888"), fontSize: 10, opacity: i === 0 ? 1 : 0.7 }}>{f}</span>
                ))}
              </div>
            )}

            {/* Optionale manuelle Ergänzung */}
            <button onClick={() => setShowManual(h => !h)}
              style={{ background: "none", border: "none", fontSize: 11, color: "#888780", cursor: "pointer",
                padding: 0, marginBottom: 10, minHeight: "auto", textDecoration: "underline" }}>
              {showManual ? "▲ Manuell ausblenden" : (selectedP ? "▾ Weitere Familien/Noten ergänzen" : "▾ Ohne Sammlung: Familie & Noten manuell eingeben")}
            </button>

            {showManual && (
              <div style={{ marginBottom: 10 }}>
                <div style={S.lbl}>WEITERE DUFTFAMILIEN <span style={{ fontWeight: 400, color: "#AAA" }}>(Stichwörter)</span></div>
                <input value={manualFamText} onChange={e => setManualFamText(e.target.value)}
                  placeholder="z.B. woody oriental, fresh citrus…"
                  style={{ ...S.inp, marginBottom: 8 }} />
                <div style={{ fontSize: 9, color: "#AAA", marginBottom: 8, lineHeight: 1.6 }}>
                  {KNOWN_FAMILIES.join(" · ")}
                </div>
                <div style={S.lbl}>NOTEN <span style={{ fontWeight: 400, color: "#AAA" }}>(kommagetrennt)</span></div>
                <input value={manualNoteText} onChange={e => setManualNoteText(e.target.value)}
                  placeholder="z.B. Bergamotte, Ambra, Vetiver, Vanille…"
                  style={{ ...S.inp }} />
              </div>
            )}

            <button onClick={runSmartMatch} disabled={!canSearch}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
                background: canSearch ? "#534AB7" : "#E8E6E0",
                color: canSearch ? "#fff" : "#B4B2A9",
                fontSize: 13, fontWeight: 500, cursor: canSearch ? "pointer" : "default",
                transition: "background .2s", marginTop: 2
              }}>
              Beste Partner finden ✧
            </button>
          </div>

          {/* Results */}
          {results && (
            <div>
              <div style={{ ...S.card, background: "#F9F8F5", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#888780", marginBottom: 4 }}>
                  {selectedP ? `Layering-Partner für ${selectedP.name}:` : "Erkannte Familien:"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {results.inputFamilies.map(f => (
                    <span key={f} style={{ ...S.pill(FAM_COLORS[f] || "#888"), fontSize: 11 }}>{f}</span>
                  ))}
                </div>
                {results.inputAllNotes.length > 0 && (
                  <div style={{ fontSize: 10, color: "#888780", marginTop: 5 }}>
                    Noten analysiert: {results.inputAllNotes.slice(0, 8).join(", ")}{results.inputAllNotes.length > 8 ? " …" : ""}
                  </div>
                )}
                <div style={{ fontSize: 9, color: "#B4B2A9", marginTop: 4, lineHeight: 1.5 }}>
                  Score = 40% Familien-Compat + 35% Noten-Kategorien + 25% direkte Noten-Überlappung
                </div>
              </div>

              {results.scored.length === 0 && (
                <div style={{ textAlign: "center", color: "#888780", fontSize: 13, padding: "24px 0" }}>Keine weiteren Parfums in der Sammlung.</div>
              )}

              {results.scored.slice(0, 10).map(({ p, score, compat, collFams, sharedCount, bridgeCount, catScore }, idx) => {
                const cc = compatColor(score);
                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : null;
                const hasNoteData = sharedCount !== undefined;
                return (
                  <div key={p.id} style={{ ...S.card, marginBottom: 8, borderLeft: `3px solid ${cc}`, opacity: score < 0.4 ? 0.6 : 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                          {medal && <span style={{ marginRight: 4 }}>{medal}</span>}{p.name}
                        </div>
                        <div style={{ fontSize: 10, color: "#888780", marginBottom: 5 }}>{p.house}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                          {collFams.map((f, i) => (
                            <span key={f} style={{ ...S.pill(FAM_COLORS[f] || "#888"), fontSize: 10, opacity: i === 0 ? 1 : 0.65 }}>{f}</span>
                          ))}
                        </div>
                        <div style={{ fontSize: 11, color: "#888780", fontStyle: "italic", lineHeight: 1.5 }}>
                          {compat.label} — {compat.desc}
                        </div>
                        {hasNoteData && (sharedCount > 0 || bridgeCount > 0) && (
                          <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
                            {sharedCount > 0 && (
                              <span style={{ fontSize: 9, background: "#EDF7F2", color: "#1D9E75", borderRadius: 4, padding: "2px 6px" }}>
                                {sharedCount} gemeinsame Note{sharedCount > 1 ? "n" : ""}
                              </span>
                            )}
                            {bridgeCount > 0 && (
                              <span style={{ fontSize: 9, background: "#F5F0FF", color: "#534AB7", borderRadius: 4, padding: "2px 6px" }}>
                                {bridgeCount} Bridge-Note{bridgeCount > 1 ? "n" : ""} ✧
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 20, color: cc, fontWeight: 400, marginLeft: 10, flexShrink: 0 }}>
                        {Math.round(score * 100)}%
                      </div>
                    </div>
                    <div style={{ height: 4, background: "#F1EFE8", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: "100%", background: cc, borderRadius: 2,
                        transform: `scaleX(${score})`, transformOrigin: "left center",
                        transition: "transform .5s cubic-bezier(0.25,0.46,0.45,0.94)"
                      }} />
                    </div>
                  </div>
                );
              })}

              {results.scored.length > 10 && (
                <div style={{ textAlign: "center", fontSize: 11, color: "#B4B2A9", padding: "4px 0 8px" }}>
                  Top 10 von {results.scored.length} angezeigt
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    function LayeringTab({ items }) {
      const [mode, setMode]           = useState("analyse");
      const [sel1, setSel1] = useState("");
      const [sel2, setSel2] = useState("");
      const [search1, setSearch1] = useState("");
      const [search2, setSearch2] = useState("");

      const p1 = items.find(p => p.id === sel1);
      const p2 = items.find(p => p.id === sel2);

      const sorted = useMemo(() =>
        [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);

      // Memoized filter lists — avoids re-scanning all items on every keystroke
      const filter1 = useMemo(() => sorted.filter(p =>
        (!search1 || p.name.toLowerCase().includes(search1.toLowerCase()) ||
          (p.house || "").toLowerCase().includes(search1.toLowerCase())) && p.id !== sel2
      ), [sorted, search1, sel2]);

      const filter2 = useMemo(() => sorted.filter(p =>
        (!search2 || p.name.toLowerCase().includes(search2.toLowerCase()) ||
          (p.house || "").toLowerCase().includes(search2.toLowerCase())) && p.id !== sel1
      ), [sorted, search2, sel1]);

      const isSamePerfume = p1 && p2 && p1.id === p2.id;

      // Use primaryFamily() so multi-family perfumes are looked up correctly
      const compat    = p1 && p2 && !isSamePerfume ? getLayerCompat(primaryFamily(p1), primaryFamily(p2)) : null;
      const noteAna   = p1 && p2 && !isSamePerfume ? analyzeNoteCompat(p1, p2) : null;
      const compatColor = compat ? (compat.score >= .8 ? "#1D9E75" : compat.score >= .6 ? "#BA7517" : "#993C1D") : "#888";

      // Smart application tip: the perfume with longer longevity should be the base layer.
      // Fall back to score threshold when longevity data is absent.
      function buildApplicationTip(p1, p2, compat) {
        const lonOrder = { short: 0, medium: 1, long: 2 };
        const lon1 = lonOrder[p1.longevity] ?? 1;
        const lon2 = lonOrder[p2.longevity] ?? 1;
        const [base, over] = lon1 >= lon2 ? [p1, p2] : [p2, p1];
        if (compat.score >= .85) {
          return `Trage ${base.name} zuerst als Basis auf, dann ${over.name} darüber. Warte 2–3 Minuten zwischen den Anwendungen.`;
        } else if (compat.score >= .65) {
          return `Vorsichtig schichten: ${base.name} sparsam als Basis, dann ${over.name} als Hauptduft.`;
        }
        return `Diese Kombination ist gewagt – teste sie zuerst auf der Handgelenk-Innenseite, bevor du sie trägst.`;
      }

      // Helper: get all family pills for a perfume
      function FamilyPills({ p }) {
        const fams = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginTop: 4 }}>
            {fams.map((f, idx) => (
              <span key={f} style={{ ...S.pill(FAM_COLORS[f] || "#888"), opacity: idx === 0 ? 1 : 0.65 }}>{f}</span>
            ))}
          </div>
        );
      }

      return (
        <div>
          {/* Mode switcher */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {[{ id: "analyse", label: "Analyse" }, { id: "smartmatch", label: "✧ Smart Match" }].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
                  background: mode === m.id ? "#534AB7" : "#F1EFE8",
                  color: mode === m.id ? "#fff" : "#888780",
                  fontSize: 12, fontWeight: mode === m.id ? 600 : 400,
                  cursor: "pointer", transition: "background .2s, color .2s"
                }}>
                {m.label}
              </button>
            ))}
          </div>

          {mode === "smartmatch" && <SmartMatchMode items={items} />}
          {mode === "analyse" && <div>

          <div style={{ ...S.card, background: "#F9F8F5", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Layering-Analyse</div>
            <div style={{ fontSize: 11, color: "#888780", lineHeight: 1.6 }}>
              Wähle zwei Parfüms – die App analysiert wie gut sie sich kombinieren lassen.
            </div>
          </div>

          {/* Selector row */}
          <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
            <LayeringPerfumeSelect label="PARFÜM 1" inputId="layering-search-1"
              search={search1} setSearch={setSearch1}
              filtered={filter1} selected={sel1} setSelected={setSel1} items={items} />
            <div style={{ fontSize: 20, color: "#B4B2A9", marginTop: 28, flexShrink: 0 }}>+</div>
            <LayeringPerfumeSelect label="PARFÜM 2" inputId="layering-search-2"
              search={search2} setSearch={setSearch2}
              filtered={filter2} selected={sel2} setSelected={setSel2} items={items} />
          </div>

          {/* Same-perfume warning */}
          {isSamePerfume && (
            <div style={{ ...S.card, border: "1px solid #BA751744", background: "#FFF8EE", marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#BA7517" }}>Bitte zwei <em>verschiedene</em> Parfüms wählen – Layering mit sich selbst ergibt keine sinnvolle Analyse.</div>
            </div>
          )}

          {/* Result */}
          {p1 && p2 && !isSamePerfume && compat && noteAna && (
            <div>
              {/* Compatibility score */}
              <div style={{ ...S.card, marginBottom: 12, borderLeft: `3px solid ${compatColor}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{compat.label}</div>
                  <div style={{ fontSize: 22, color: compatColor, fontWeight: 400 }}>
                    {Math.round(compat.score * 100)}%
                  </div>
                </div>
                {/* scaleX instead of width – GPU-composited, no layout recalc */}
                <div style={{ height: 6, background: "#F1EFE8", borderRadius: 3, marginBottom: 10, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: "100%",
                    background: compatColor, borderRadius: 3,
                    transform: `scaleX(${compat.score})`, transformOrigin: "left center",
                    transition: "transform .5s cubic-bezier(0.25,0.46,0.45,0.94)"
                  }} />
                </div>
                <div style={{ fontSize: 12, color: "#888780", fontStyle: "italic" }}>{compat.desc}</div>
              </div>

              {/* Family cards – show all families, not just primary */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, marginBottom: 12, alignItems: "center" }}>
                <div style={{ ...S.card, marginBottom: 0, textAlign: "center", padding: "10px" }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p1.name}</div>
                  <FamilyPills p={p1} />
                </div>
                <div style={{ fontSize: 14, color: "#B4B2A9", textAlign: "center" }}>+</div>
                <div style={{ ...S.card, marginBottom: 0, textAlign: "center", padding: "10px" }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p2.name}</div>
                  <FamilyPills p={p2} />
                </div>
              </div>

              {/* Missing notes hint */}
              {(!noteAna.hasP1Notes || !noteAna.hasP2Notes) && (
                <div style={{ ...S.card, background: "#FFFBF0", border: "1px solid #E8E6E044", marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#888780" }}>
                    ⓘ {!noteAna.hasP1Notes && !noteAna.hasP2Notes
                      ? "Für beide Parfüms sind keine Noten hinterlegt"
                      : `Für ${(!noteAna.hasP1Notes ? p1 : p2).name} sind keine Noten hinterlegt`}
                    {" "}– Noten-Analyse nicht möglich. Trage Noten in der Sammlung nach für eine vollständige Analyse.
                  </div>
                </div>
              )}

              {/* Bridge notes */}
              {noteAna.bridgeNotes.length > 0 && (
                <div style={{ ...S.card, marginBottom: 12 }}>
                  <div style={S.lbl}>BRÜCKEN-NOTEN (was du wirklich riechst)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {noteAna.bridgeNotes.map(n => (
                      <span key={n} style={{ ...S.pill("#534AB7"), fontSize: 11, padding: "3px 9px" }}>{n}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#888780", marginTop: 6 }}>
                    Basisnoten beider Parfüms treffen auf die jeweiligen Kopfnoten des anderen
                  </div>
                </div>
              )}

              {/* Shared notes */}
              {noteAna.shared.length > 0 && (
                <div style={{ ...S.card, marginBottom: 12 }}>
                  <div style={S.lbl}>GEMEINSAME NOTEN ({noteAna.shared.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {noteAna.shared.slice(0, 10).map(n => (
                      <span key={n} style={{ ...S.pill("#1D9E75"), fontSize: 11, padding: "3px 9px" }}>{n}</span>
                    ))}
                    {noteAna.shared.length > 10 && (
                      <span style={{ fontSize: 10, color: "#888780", alignSelf: "center" }}>+{noteAna.shared.length - 10} weitere</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "#888780", marginTop: 6 }}>
                    Gemeinsame Noten stärken die Harmonie
                  </div>
                </div>
              )}

              {/* Application tip */}
              <div style={{ ...S.card, background: "#F9F8F5" }}>
                <div style={S.lbl}>ANWENDUNGS-TIPP</div>
                <div style={{ fontSize: 12, color: "#888780", lineHeight: 1.6 }}>
                  {buildApplicationTip(p1, p2, compat)}
                </div>
              </div>
            </div>
          )}

          {(!p1 || !p2) && !isSamePerfume && (
            <div style={{ textAlign: "center", color: "#888780", fontSize: 13, padding: "40px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>+</div>
              Wähle zwei Parfüms aus deiner Sammlung
            </div>
          )}
          </div>}
        </div>
      );
    }

    // ── Heute tab ─────────────────────────────────────────────────────────────────
    // ── Spray-Animation (Partikel beim Tragen) ────────────────────────────────────
    function triggerSprayAnimation(buttonEl) {
      if (!buttonEl) return;
      const rect = buttonEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const colors = ["#534AB7", "#1D9E75", "#BA7517", "#D4537E", "#185FA5"];
      // Attach to #root (the app's fixed container) rather than body.
      // On iOS with position:fixed on body, particles appended to body can end up
      // outside the visible viewport or get clipped by the safe-area region.
      const container = document.getElementById("root") || document.body;
      for (let i = 0; i < 12; i++) {
        const el = document.createElement("div");
        const angle = (i / 12) * 2 * Math.PI - Math.PI / 2 + (Math.random() - 0.5) * 0.8;
        const dist = 28 + Math.random() * 32;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist - 10;
        const size = 4 + Math.random() * 5;
        el.style.cssText = `
          position:fixed; left:${cx}px; top:${cy}px;
          width:${size}px; height:${size}px; border-radius:50%;
          background:${colors[i % colors.length]};
          pointer-events:none; z-index:99999;
          --dx:${dx}px; --dy:${dy}px;
          animation:sprayParticle 0.55s cubic-bezier(0.25,0.46,0.45,0.94) forwards;
          margin-left:-${size/2}px; margin-top:-${size/2}px;
        `;
        container.appendChild(el);
        setTimeout(() => el.remove(), 600);
      }
    }

    function HeuteTab({ items, log, onLog, pushError, prefs, priceMl, onSelectPerfume, onNavigate, userNotePrefs, userFamilyPrefs }) {
      const season = getSeason(), sc = SEASON_COLORS[season];
      const [weather, setWeather] = useState("sunny");
      const [occasion, setOccasion] = useState("casual");
      const [mood, setMood] = useState("energetic");
      const [timeOfDay, setTime] = useState("morning");
      const [intensityPref, setIntensity] = useState("medium");
      const [longevityPref, setLongevity] = useState("medium");
      const [priceRange, setPriceRange] = useState(null);    // null|"budget"|"mid"|"luxury"
      const [genderPref, setGenderPref] = useState(null);    // null|"Feminin"|"Maskulin"|"Unisex"
      const [recs, setRecs] = useState(null);
      const [worn, setWorn] = useState({});
      const [weatherData, setWeatherData] = useState(null);
      const [weatherLoading, setWeatherLoading] = useState(false);

      async function fetchAutoWeather() {
        if (!navigator.geolocation) return;
        setWeatherLoading(true);
        try {
          const pos = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
          const data = await withRetry(() => fetchWeather(pos.coords.latitude, pos.coords.longitude));
          setWeatherData(data);
          // Auto-apply weather
          const humid = humidityIntensityMod(data.humidity);
          if (humid) setIntensity(humid);
        } catch (e) {
          if (pushError) pushError(e, { hint: "Wetterdaten konnten nicht geladen werden. Bitte manuell auswählen." });
        }
        setWeatherLoading(false);
      }

      function applyWeather() {
        if (!weatherData) return;
        setWeather(weatherData.effectiveWeather);
        const humid = humidityIntensityMod(weatherData.humidity);
        if (humid) setIntensity(humid);
      }
      const [open, setOpen] = useState({ crit: true, res: true, alts: true, wild: true });
      const [loadingRecs, setLoadingRecs] = useState(false);
      // ── KI-Tagesbeschreibung ──
      const [showAiInput, setShowAiInput] = useState(false);
      const [aiText, setAiText] = useState("");
      const [aiLoading, setAiLoading] = useState(false);
      const [aiErr, setAiErr] = useState("");
      const tog = k => setOpen(o => ({ ...o, [k]: !o[k] }));
      const groqCountdown = useGroqCountdown(); // Sekunden bis Rate-Limit abläuft

      useEffect(() => {
        const h = new Date().getHours();
        setTime(h < 10 ? "morning" : h < 14 ? "afternoon" : h < 20 ? "evening" : "night");
      }, []);

      async function interpretDayDescription(text) {
        // Aktuellen Kontext als Zusatz-Info für die KI aufbauen (buildPromptContext)
        const currentCtxHint = buildPromptContext({
          occasion, mood, timeOfDay, weather, season,
          intensityPref, longevityPref, priceRange, genderPref, userFamilyPrefs,
        });
        const systemPrompt = `Du bist ein Parfum-Berater. Analysiere eine kurze Tagesbeschreibung und gib optimierte Duftparameter zurück.
Beachte den aktuellen Kontext (Saison, Wetter usw.) – du kannst davon abweichen wenn die Beschreibung es nahelegt.
Antworte NUR mit einem validen JSON-Objekt, kein Markdown, keine Erklärung.`;
        const userPrompt = `Tagesbeschreibung: "${text}"

Aktueller Kontext (zur Orientierung):
${currentCtxHint}

Analysiere und bestimme optimierte Werte für:
- occasion: eines von [casual, work, sport, evening, date, sleep, special, outdoor, travel, vacation]
- mood: eines von [energetic, calm, romantic, confident, mysterious, playful, sleep]
- timeOfDay: eines von [morning, afternoon, evening, night]
- intensityPref: eines von [light, medium, strong]
- longevityPref: eines von [short, medium, long]
- reasoning: ein deutscher Satz warum (max 80 Zeichen)

Antworte NUR mit JSON: {"occasion":"...","mood":"...","timeOfDay":"...","intensityPref":"...","longevityPref":"...","reasoning":"..."}`;

        const { text: raw, fromCache } = await groqFetch({
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          temperature: 0.3, max_tokens: 150,
          cacheKey: "day:" + text.slice(0, 40) + season + weather,
        });
        const m = raw.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
        if (!m) throw new Error("KI-Antwort konnte nicht gelesen werden.");
        try { const parsed = JSON.parse(m[0]); return { ...parsed, _fromCache: fromCache }; } catch { throw new Error("KI-Antwort konnte nicht verarbeitet werden."); }
      }

      async function handleAiGenerate() {
        if (!aiText.trim()) return;
        setAiLoading(true); setAiErr("");
        // Valid value sets – used to sanitize AI output before applying to app state
        const VALID_OCCASIONS = new Set(OCCASIONS.map(o => o.id));
        const VALID_MOODS     = new Set(MOODS.map(m => m.id));
        const VALID_TIMES     = new Set(TIMES.map(t => t.id));
        const VALID_INT       = new Set(INTENSITIES.map(i => i.id));
        const VALID_LON       = new Set(LONGEVITIES.map(l => l.id));
        try {
          const result = await interpretDayDescription(aiText.trim());
          const _fromCache = result._fromCache;
          // Sanitize: only apply values that exist in the app's enum lists.
          // Unknown AI values (e.g. "formal", "happy", "focused") are silently dropped
          // so they don't corrupt the score context.
          const safeOcc = VALID_OCCASIONS.has(result.occasion) ? result.occasion : null;
          const safeMood = VALID_MOODS.has(result.mood) ? result.mood : null;
          const safeTime = VALID_TIMES.has(result.timeOfDay) ? result.timeOfDay : null;
          const safeInt  = VALID_INT.has(result.intensityPref) ? result.intensityPref : null;
          const safeLon  = VALID_LON.has(result.longevityPref) ? result.longevityPref : null;
          if (safeOcc)  setOccasion(safeOcc);
          if (safeMood) setMood(safeMood);
          if (safeTime) setTime(safeTime);
          if (safeInt)  setIntensity(safeInt);
          if (safeLon)  setLongevity(safeLon);
          setShowAiInput(false);
          setAiText("");
          // Direkt Empfehlung generieren mit neuen Werten
          setLoadingRecs(true);
          setTimeout(() => {
            const ctx = {
              season, weather,
              occasion: safeOcc || occasion,
              mood: safeMood || mood,
              timeOfDay: safeTime || timeOfDay,
              intensityPref: safeInt || intensityPref,
              longevityPref: safeLon || longevityPref,
              log, userNotePrefs, userFamilyPrefs,
              priceRange, genderPref, priceMl,
              aiReasoning: result.reasoning
            };
            setRecs({ ...generateRecommendations(items, ctx), _aiReasoning: result.reasoning, _fromCache: _fromCache });
            setWorn({});
            setLoadingRecs(false);
          }, 300);
        } catch(e) {
          setAiErr(e.message);
        }
        setAiLoading(false);
      }

      const generateTimerRef = useRef(null);
      function generate() {
        // Cancel any pending generate call so rapid double-taps don't race
        if (generateTimerRef.current) clearTimeout(generateTimerRef.current);
        setLoadingRecs(true);
        generateTimerRef.current = setTimeout(() => {
          generateTimerRef.current = null;
          // Schlafen-Modus: Intensität immer auf Leicht setzen
          const effectiveIntensity = (mood === "sleep" || occasion === "sleep") ? "light" : intensityPref;
          const effectiveLongevity = (mood === "sleep" || occasion === "sleep") ? "short" : longevityPref;
          const ctx = {
            season, weather, occasion, mood, timeOfDay,
            intensityPref: effectiveIntensity,
            longevityPref: effectiveLongevity,
            log,
            userNotePrefs,
            userFamilyPrefs,
            priceRange, genderPref, priceMl,
          };
          setRecs(generateRecommendations(items, ctx));
          setWorn({});
          setLoadingRecs(false);
        }, 300);
      }

      function wear(p, btnEl) {
        onLog(p);
        setWorn(prev => ({ ...prev, [p.id]: true }));
        triggerSprayAnimation(btnEl);
      }

      const Sec = ({ id, lbl, children }) => (
        <div style={{ marginBottom: 16 }}>
          <div onClick={() => tog(id)} style={{ display: "flex", justifyContent: "space-between", cursor: "pointer", marginBottom: 8 }}>
            <div style={S.lbl}>{lbl}</div>
            <div style={{ fontSize: 10, color: "#888780" }}>{open[id] ? "▲" : "▼"}</div>
          </div>
          {open[id] && children}
        </div>
      );

      // Karte für eine Empfehlung
      function RecCard({ p, role, rank }) {
        const isTop1 = role === "top1";
        const isWild = role === "wildcard";
        const fc = FAM_COLORS[p.family] || "#888";
        const families = p.families && p.families.length > 0 ? p.families : (p.family ? [p.family] : []);
        const familyDisplay = families.length > 0 ? families.join(", ") : "Sonstiges";
        const familyColor = families.length > 0 ? FAM_COLORS[families[0]] || "#888" : "#888";
        const reason = buildReason(p, { season, weather, occasion, mood, timeOfDay, intensityPref, longevityPref, log }, role, log);
        const wornNow = worn[p.id];
        const todayStr = new Date().toDateString();
        const wornToday = log.some(l => l.id === p.id && new Date(l.ts).toDateString() === todayStr);

        const borderStyle = isTop1
          ? "1.5px solid #1A1A18"
          : isWild
            ? `1px dashed ${fc}`
            : "1px solid #E8E6E0";

        return (
          <div style={{ ...S.card, border: borderStyle, marginBottom: 10, padding: "12px 14px" }}>
            {/* Rang-Badge */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isTop1 && <span style={{ fontSize: 9, letterSpacing: "1px", background: "#1A1A18", color: "#fff", padding: "2px 7px", borderRadius: 10 }}>BESTE WAHL</span>}
                {isWild && <span style={{ fontSize: 9, letterSpacing: "1px", background: fc + "22", color: fc, padding: "2px 7px", borderRadius: 10 }}>WILDCARD</span>}
                {["alt1", "alt2"].includes(role) && <span style={{ fontSize: 9, letterSpacing: "1px", color: "#888780" }}>ALTERNATIVE</span>}
                {["top2", "top3"].includes(role) && <span style={{ fontSize: 9, letterSpacing: "1px", color: "#888780" }}>#{rank}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, marginBottom: 1, fontWeight: isTop1 ? 500 : 400 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#888780", marginBottom: 6 }}>{p.house} · {p.conc}</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                  {families.map((f, idx) => (
                    <span key={f} style={idx === 0 ? S.pill(FAM_COLORS[f] || "#888") : { fontSize: 9, padding: "2px 8px", borderRadius: 12, border: `1px solid ${FAM_COLORS[f] || "#888"}`, background: "transparent", color: FAM_COLORS[f] || "#888", fontWeight: 400 }}>{f}</span>
                  ))}
                  <span style={S.pill("#888780")}>{p.season}</span>
                  <span style={S.pill("#888780")}>{p.format}</span>
                </div>
                {(p.rating || 0) > 0 && <Stars rating={p.rating} size={12} />}
                {/* Begründung */}
                <div style={{ fontSize: 10, color: "#888780", marginTop: 6, lineHeight: 1.5, fontStyle: "italic" }}>
                  {reason}
                </div>
              </div>
              <div style={{ marginLeft: 12, textAlign: "center", flexShrink: 0 }}>
                {wornNow || wornToday
                  ? <div style={{ fontSize: 11, color: "#1D9E75" }}>✓ getragen</div>
                  : <button onClick={e => wear(p, e.currentTarget)} style={{ ...S.btn("out"), fontSize: 11, padding: "6px 10px" }}>Tragen</button>
                }
              </div>
            </div>
          </div>
        );
      }

      return (
        <div>
          {/* Datum/Saison-Karte */}
          <div style={{ ...S.card, background: sc.bg, border: `1px solid ${sc.accent}33`, marginBottom: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: "1.5px", color: sc.text, marginBottom: 3 }}>
              {new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}
            </div>
            <div style={{ fontSize: 18, color: sc.text }}>{season}</div>
          </div>

          {/* Wetter-Widget */}
          <div style={{ ...S.card, marginBottom: 12, padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: weatherData ? 8 : 0 }}>
              <div style={S.lbl}>WETTER AUTOMATISCH ERKENNEN</div>
              <button onClick={fetchAutoWeather} disabled={weatherLoading}
                style={{
                  ...S.btn("out"), fontSize: 10, padding: "5px 10px", borderRadius: 16,
                  opacity: weatherLoading ? .6 : 1
                }}>
                {weatherLoading ? "…" : "Standort nutzen"}
              </button>
            </div>
            {weatherData && <WeatherWidget weatherData={weatherData} onUse={applyWeather} />}
            {!weatherData && <div style={{ fontSize: 10, color: "#B4B2A9" }}>Oder manuell unten auswählen.</div>}
          </div>

          <Sec id="crit" lbl="KRITERIEN">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><div style={S.lbl}>STIMMUNG</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                  {MOODS.map(m => (
                    <button key={m.id} onClick={() => setMood(m.id)}
                      style={{ ...S.chip(mood === m.id), padding: "10px 6px", textAlign: "center", borderRadius: 10 }}>
                      <div style={{ fontSize: 16, marginBottom: 2 }}>{m.icon}</div>
                      <div style={{ fontSize: 10 }}>{m.label}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div><div style={S.lbl}>TAGESZEIT</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {TIMES.map(t => (
                      <button key={t.id} onClick={() => setTime(t.id)} style={{ ...S.chip(timeOfDay === t.id), padding: "6px 10px", fontSize: 11 }}>{t.label}</button>
                    ))}
                  </div>
                </div>
                <div><div style={S.lbl}>WETTER</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {WEATHERS.map(w => (
                      <button key={w.id} onClick={() => setWeather(w.id)} style={{ ...S.chip(weather === w.id), padding: "6px 10px", fontSize: 11 }}>{w.label}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div><div style={S.lbl}>ANLASS</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                  {OCCASIONS.map(o => (
                    <button key={o.id} onClick={() => setOccasion(o.id)}
                      style={{ ...S.chip(occasion === o.id), padding: "8px 2px", textAlign: "center", borderRadius: 10 }}>
                      <div style={{ fontSize: 14, marginBottom: 1 }}>{o.icon}</div>
                      <div style={{ fontSize: 8, lineHeight: 1.2 }}>{o.label}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><div style={S.lbl}>INTENSITÄT</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {INTENSITIES.map(i => (
                      <button key={i.id} onClick={() => setIntensity(i.id)}
                        style={{ ...S.chip(intensityPref === i.id), display: "flex", justifyContent: "space-between", borderRadius: 8, padding: "8px 12px" }}>
                        <span>{i.label}</span><span style={{ fontSize: 9, opacity: .7 }}>{i.note}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div><div style={S.lbl}>HALTBARKEIT</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {LONGEVITIES.map(l => (
                      <button key={l.id} onClick={() => setLongevity(l.id)}
                        style={{ ...S.chip(longevityPref === l.id), display: "flex", justifyContent: "space-between", borderRadius: 8, padding: "8px 12px" }}>
                        <span>{l.label}</span><span style={{ fontSize: 9, opacity: .7 }}>{l.note}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Optionale erweiterte Filter */}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={S.lbl}>PREISBEREICH (optional)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {[["budget","Budget","< 30€"],["mid","Mittel","30–100€"],["luxury","Luxus","> 100€"]].map(([id,label,note]) => (
                      <button key={id} onClick={() => setPriceRange(priceRange === id ? null : id)}
                        style={{ ...S.chip(priceRange === id, "#BA7517"), display: "flex", justifyContent: "space-between", borderRadius: 8, padding: "6px 10px", fontSize: 11 }}>
                        <span>{label}</span><span style={{ fontSize: 9, opacity: .7 }}>{note}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={S.lbl}>GENDER (optional)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {[["Feminin","♀"],["Maskulin","♂"],["Unisex","⚥"]].map(([id,icon]) => (
                      <button key={id} onClick={() => setGenderPref(genderPref === id ? null : id)}
                        style={{ ...S.chip(genderPref === id, "#185FA5"), display: "flex", gap: 6, borderRadius: 8, padding: "6px 10px", fontSize: 11, alignItems: "center" }}>
                        <span style={{ fontSize: 12 }}>{icon}</span><span>{id}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Sec>

          {/* ── KI-Tagesbeschreibung ─────────────────────────────────── */}
          <div style={{ ...S.card, marginBottom: 12, padding: "14px 16px", borderRadius: 14,
            background: showAiInput ? "#F4F3FD" : "#fff",
            border: showAiInput ? "1.5px solid #534AB7" : "1px solid #E8E6E0",
            transition: "all .2s" }}>
            {!showAiInput ? (
              <button onClick={() => setShowAiInput(true)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  fontFamily: "'Georgia',serif", textAlign: "left" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%",
                  background: "linear-gradient(135deg, #534AB7, #1D9E75)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, fontSize: 14 }}>✦</div>
                <div>
                  <div style={{ fontSize: 12, color: "#1A1A18", fontWeight: 500 }}>Beschreib deinen Tag</div>
                  <div style={{ fontSize: 11, color: "#888780" }}>KI wählt passende Regler aus</div>
                </div>
                <div style={{ marginLeft: "auto", fontSize: 10, color: "#B4B2A9" }}>▸</div>
              </button>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: "1.5px", color: "#534AB7" }}>BESCHREIB DEINEN TAG</div>
                  <button onClick={() => { setShowAiInput(false); setAiText(""); setAiErr(""); }}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9", padding: 0 }}>✕</button>
                </div>

                {/* Quick examples */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {["Romantisches Dinner", "Gym & Sport", "Büro-Meeting", "Strandurlaub", "Gemütlicher Abend"].map(ex => (
                    <button key={ex} onClick={() => setAiText(ex)}
                      style={{ fontSize: 10, padding: "5px 10px", borderRadius: 20,
                        border: "1px solid #D3D1C7", background: aiText === ex ? "#534AB7" : "#fff",
                        color: aiText === ex ? "#fff" : "#888780", cursor: "pointer", transition: "all .1s" }}>
                      {ex}
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={aiText}
                    onChange={e => setAiText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAiGenerate(); } }}
                    placeholder='z.B. "Abendessen mit Freunden" oder "langer Arbeitstag"'
                    autoFocus
                    style={{ ...S.inp, flex: 1, fontSize: 13, borderRadius: 10,
                      border: "1.5px solid #534AB7", background: "#fff" }}
                  />
                  <button onClick={handleAiGenerate} disabled={aiLoading || !aiText.trim()}
                    style={{ ...S.btn("pri"), padding: "12px 16px", borderRadius: 10, fontSize: 12,
                      opacity: aiLoading || !aiText.trim() ? 0.5 : 1,
                      background: "linear-gradient(135deg, #534AB7, #7B6FCF)",
                      boxShadow: "0 2px 8px rgba(83,74,183,0.3)", whiteSpace: "nowrap" }}>
                    {aiLoading ? "…" : "✦ Los"}
                  </button>
                </div>
                {groqCountdown > 0 && (
                  <div style={{ fontSize: 11, color: "#BA7517", marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>⏱</span>
                    <span>API-Limit – verfügbar in <strong>{groqCountdown}s</strong>. Zwischengespeicherte Antworten werden genutzt.</span>
                  </div>
                )}
                {aiErr && !aiErr.includes("RATE_LIMIT") && <div style={{ fontSize: 11, color: "#E24B4A", marginTop: 8 }}>{aiErr}</div>}
              </div>
            )}
          </div>

          <button onClick={generate} disabled={loadingRecs}
            style={{
              ...S.btn("pri"), width: "100%", padding: "14px", borderRadius: 10, marginBottom: 20, fontSize: 14,
              opacity: loadingRecs ? 0.6 : 1, cursor: loadingRecs ? "wait" : "pointer"
            }}>
            {loadingRecs ? "Berechne..." : (recs ? "Neu empfehlen" : "Empfehlung generieren")}
          </button>

          {recs && (
            <div>
              {/* KI-Reasoning Banner */}
              {recs._aiReasoning && (
                <div style={{ ...S.card, background: "#F4F3FD", border: "1px solid #534AB722",
                  marginBottom: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>✦</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#534AB7", fontStyle: "italic" }}>{recs._aiReasoning}</div>
                    {recs._fromCache && (
                      <div style={{ fontSize: 10, color: "#B4B2A9", marginTop: 3 }}>◎ Aus Cache – KI-Limit aktiv</div>
                    )}
                  </div>
                </div>
              )}
              {/* Top 3 */}
              <Sec id="res" lbl="TOP 3 HEUTE">
                {recs.top3.map((p, i) => (
                  <RecCard key={p.id} p={p} role={["top1", "top2", "top3"][i]} rank={i + 1} />
                ))}
              </Sec>

              {/* Alternativen */}
              {recs.alts.length > 0 && (
                <Sec id="alts" lbl="ALTERNATIVEN">
                  {recs.alts.map((p, i) => (
                    <RecCard key={p.id} p={p} role={["alt1", "alt2"][i]} rank={4 + i} />
                  ))}
                </Sec>
              )}

              {/* Wildcard */}
              {recs.wildcard && (
                <Sec id="wild" lbl="WILDCARD">
                  <RecCard p={recs.wildcard} role="wildcard" rank={0} />
                </Sec>
              )}
            </div>
          )}

          {items.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.6, animation: "float 4s ease-in-out infinite" }}>🌸</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: "#1A1A18", marginBottom: 8, animation: "fadeIn .6s ease-out both", animationDelay: "0.1s" }}>Deine Sammlung ist leer</div>
              <div style={{ fontSize: 13, color: "#888780", lineHeight: 1.6, marginBottom: 20, animation: "fadeIn .6s ease-out both", animationDelay: "0.2s" }}>
                Importiere deine Parfüms als TSV-Datei<br />oder füge sie einzeln hinzu.
              </div>
              <button onClick={() => onNavigate && onNavigate("settings")}
                style={{ ...S.btn("pri"), padding: "12px 24px", fontSize: 13, animation: "fadeIn .6s ease-out both", animationDelay: "0.3s" }}>
                → Zu Einstellungen
              </button>
            </div>
          )}
        </div>
      );
    }

    // ── Note synonym map + search engine ─────────────────────────────────────────
    // Maps every known variant to a canonical German key.
    // Both the query AND the note values are normalized through this map,
    // so "Tobacco", "Tabac", "Tabacco" all match a search for "Tabak".
    const SYNONYMS = {
      // Tabak
      tobacco: "tabak", tabac: "tabak", tabacco: "tabak", tabak: "tabak",
      // Vanille
      vanilla: "vanille", vanillin: "vanille", vanille: "vanille",
      // Moschus
      musk: "moschus", musc: "moschus", muschus: "moschus", moschus: "moschus",
      // Sandelholz
      sandalwood: "sandelholz", santal: "sandelholz", sandal: "sandelholz", sandelholz: "sandelholz",
      // Zedernholz
      cedarwood: "zedernholz", cedar: "zedernholz", cèdre: "zedernholz", zeder: "zedernholz", zedernholz: "zedernholz",
      // Ambra
      amber: "ambra", ambre: "ambra", ambergris: "ambra", ambra: "ambra", ambroxan: "ambra",
      // Oud
      oudh: "oud", aoud: "oud", oud: "oud",
      // Patschuli
      patchouli: "patschuli", patchuly: "patschuli", patschuli: "patschuli",
      // Bergamotte
      bergamot: "bergamotte", bergamotto: "bergamotte", bergamotte: "bergamotte",
      // Jasmin
      jasmine: "jasmin", jasminum: "jasmin", jasmin: "jasmin",
      // Rose
      rose: "rose", rosa: "rose", rosen: "rose",
      // Iris
      orris: "iris", iris: "iris",
      // Vetiver
      vetiver: "vetiver", vétiver: "vetiver",
      // Tonkabohne
      tonka: "tonkabohne", "fève tonka": "tonkabohne", tonkabohne: "tonkabohne",
      // Lavendel
      lavender: "lavendel", lavande: "lavendel", lavendel: "lavendel",
      // Zitrone
      lemon: "zitrone", citron: "zitrone", limone: "zitrone", citrus: "zitrus", zitrone: "zitrone",
      // Mandarine
      mandarin: "mandarine", tangerine: "mandarine", mandarine: "mandarine",
      // Kardamom
      cardamom: "kardamom", cardamome: "kardamom", kardamom: "kardamom",
      // Zimt
      cinnamon: "zimt", cannelle: "zimt", zimt: "zimt",
      // Ingwer
      ginger: "ingwer", gingembre: "ingwer", ingwer: "ingwer",
      // Neroli
      neroli: "neroli", néroli: "neroli",
      // Grapefruit
      pampelmuse: "grapefruit", grapefruit: "grapefruit",
      // Limette
      lime: "limette", limette: "limette",
      // Honig
      honey: "honig", miel: "honig", honig: "honig",
      // Leder
      leather: "leder", cuir: "leder", leder: "leder",
      // Eichenmoos
      oakmoss: "eichenmoos", mousse: "eichenmoos", eichenmoos: "eichenmoos",
      // Karamell
      caramel: "karamell", karamell: "karamell",
      // Pfeffer
      pepper: "pfeffer", poivre: "pfeffer", pfeffer: "pfeffer",
      // Zimt -> already done
      // Zypresse
      cypress: "zypresse", zypresse: "zypresse",
      // Pflaume
      plum: "pflaume", prune: "pflaume", pflaume: "pflaume",
      // Kirsche
      cherry: "kirsche", cerise: "kirsche", kirsche: "kirsche",
      // Feige
      fig: "feige", figue: "feige", feige: "feige",
      // Kaffee
      coffee: "kaffee", café: "kaffee", kaffee: "kaffee",
    };

    function normalizeTerm(raw) {
      const t = normalizeText(raw);
      return SYNONYMS[t] || t;
    }

    // Parse query string into normalized terms (split on whitespace or comma)
    function parseQuery(q) {
      return q.split(/[\s,]+/).map(t => t.trim()).filter(Boolean).map(normalizeTerm);
    }

    // Get all normalized note tokens for a perfume
    function perfumeNoteTokens(p) {
      const allNotes = [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)];
      return allNotes.map(n => normalizeTerm(n));
    }

    // Core match function: returns {matched: bool, hits: [{field, value}]}
    // Every term must match at least one field (AND logic)
    function matchPerfume(p, terms) {
      if (!terms.length) return { matched: true, hits: [] };
      const nameNorm = normalizeTerm(p.name || "");
      const houseNorm = normalizeTerm(p.house || "");
      const familyNorm = normalizeTerm(p.family || "");
      const nameTokens = tokenizeText(p.name || "").map(normalizeTerm);
      const houseTokens = tokenizeText(p.house || "").map(normalizeTerm);
      const noteCache = [["top", p.top], ["middle", p.middle], ["base", p.base]].map(([field, raw]) => {
        const notes = splitNotes(raw || "");
        return { field, notes, normNotes: notes.map(n => normalizeTerm(n)) };
      });
      const hits = [];
      for (const term of terms) {
        let termHit = false;
        // Name
        if (nameNorm.includes(term) || nameTokens.some(t => t.startsWith(term))) {
          hits.push({ field: "name", value: p.name, term });
          termHit = true;
        }
        // House
        if (!termHit && (houseNorm.includes(term) || houseTokens.some(t => t.startsWith(term)))) {
          hits.push({ field: "house", value: p.house, term });
          termHit = true;
        }
        // Notes (top / middle / base)
        if (!termHit) {
          for (const block of noteCache) {
            for (let i = 0; i < block.notes.length; i++) {
              const note = block.notes[i];
              const noteNorm = block.normNotes[i];
              if (noteNorm.includes(term)) {
                hits.push({ field: block.field, value: note, term });
                termHit = true;
                break;
              }
            }
            if (termHit) break;
          }
        }
        // Family
        if (!termHit && familyNorm.includes(term)) {
          hits.push({ field: "family", value: p.family, term });
          termHit = true;
        }
        if (!termHit) return { matched: false, hits: [] };
      }
      return { matched: true, hits };
    }

    // Collect all unique notes from collection, sorted by frequency
    function getAllNotes(items) {
      const c = {};
      items.forEach(p => {
        [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
          .forEach(n => { const k = n.trim(); if (k) c[k] = (c[k] || 0) + 1; });
      });
      return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([n]) => n);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: COST PER WEAR
    // ══════════════════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: MOOD HEADER (dynamischer Gradient pro Duftfamilie)
    // ══════════════════════════════════════════════════════════════════════════════
    const MOOD_GRADIENTS = {
      Floral:      { g: "linear-gradient(135deg, #FADADD 0%, #F4C2C2 30%, #E8A0BF 60%, #D4537E 100%)",    accent: "#D4537E", icon: "✿" },
      Woody:       { g: "linear-gradient(135deg, #E8DCC8 0%, #C4A882 30%, #8B6F47 60%, #5C4033 100%)",    accent: "#8B6F47", icon: "⌁" },
      Oriental:    { g: "linear-gradient(135deg, #F7E8D0 0%, #C9956B 30%, #8B5E3C 50%, #4A2C17 100%)",    accent: "#8B5E3C", icon: "✦" },
      Fresh:       { g: "linear-gradient(135deg, #E0F7FA 0%, #B2EBF2 30%, #80DEEA 60%, #1D9E75 100%)",    accent: "#1D9E75", icon: "❃" },
      Chypre:      { g: "linear-gradient(135deg, #E8E4D9 0%, #A8B5A0 30%, #6B8E5A 60%, #3E5C2B 100%)",    accent: "#6B8E5A", icon: "⊛" },
      "Fougère":   { g: "linear-gradient(135deg, #E8EDE4 0%, #B5C9A8 30%, #7BA05B 60%, #3B6D11 100%)",    accent: "#7BA05B", icon: "⌘" },
      Gourmand:    { g: "linear-gradient(135deg, #FFF0E0 0%, #F5C6AA 30%, #E89B7A 55%, #C2604A 100%)",    accent: "#E89B7A", icon: "◉" },
      Aquatisch:   { g: "linear-gradient(135deg, #DAEEF3 0%, #A8D8EA 30%, #6CB4D4 60%, #2E86AB 100%)",    accent: "#2E86AB", icon: "≋" },
      Zitrisch:    { g: "linear-gradient(135deg, #FFFDE7 0%, #FFF176 30%, #FFD600 60%, #C9A825 100%)",    accent: "#C9A825", icon: "◌" },
      Süß:         { g: "linear-gradient(135deg, #FCE4EC 0%, #F8BBD9 30%, #F48FB1 60%, #D4537E 100%)",    accent: "#D4537E", icon: "✶" },
      Würzig:      { g: "linear-gradient(135deg, #FFF3E0 0%, #FFCC80 30%, #FFA726 60%, #BA7517 100%)",    accent: "#BA7517", icon: "✳" },
      Grün:        { g: "linear-gradient(135deg, #E8F5E9 0%, #A5D6A7 30%, #66BB6A 60%, #5C6B4F 100%)",    accent: "#5C6B4F", icon: "✾" },
      Animalisch:  { g: "linear-gradient(135deg, #EFEBE9 0%, #BCAAA4 30%, #8D6E63 60%, #8B4513 100%)",    accent: "#8B4513", icon: "◈" },
      Harzig:      { g: "linear-gradient(135deg, #FBE9E7 0%, #FFAB91 30%, #A1632A 60%, #8B5E3C 100%)",    accent: "#8B5E3C", icon: "◆" },
      Rauchig:     { g: "linear-gradient(135deg, #ECEFF1 0%, #B0BEC5 30%, #78909C 60%, #5F5E5A 100%)",    accent: "#5F5E5A", icon: "◎" },
      Pudrig:      { g: "linear-gradient(135deg, #FCE4EC 0%, #E8C8D4 30%, #D4A8BC 60%, #C4A0B0 100%)",    accent: "#C4A0B0", icon: "◯" },
      Fruchtig:    { g: "linear-gradient(135deg, #FFF8E1 0%, #FFCC80 30%, #FF8A65 60%, #C2604A 100%)",    accent: "#C2604A", icon: "✺" },
      Erdig:       { g: "linear-gradient(135deg, #EFEBE9 0%, #D7CCC8 30%, #A1887F 60%, #6B5B3E 100%)",    accent: "#6B5B3E", icon: "◭" },
      Cremig:      { g: "linear-gradient(135deg, #FFF8E1 0%, #FFECB3 30%, #FFD54F 60%, #E89B7A 100%)",    accent: "#E89B7A", icon: "◍" },
      Synthetisch: { g: "linear-gradient(135deg, #EDE7F6 0%, #B39DDB 30%, #9575CD 60%, #7F77DD 100%)",    accent: "#7F77DD", icon: "⌖" },
      Sonstiges:   { g: "linear-gradient(135deg, #EDEDED 0%, #C8C8C8 30%, #9E9E9E 60%, #5F5E5A 100%)",    accent: "#888780", icon: "◇" },
    };

    function MoodHeader({ family, base, families }) {
      const primaryFamily = (families && families.length > 0) ? families[0] : family;
      const mood = MOOD_GRADIENTS[primaryFamily] || MOOD_GRADIENTS["Sonstiges"];
      const notes = splitNotes(base);
      const topNotes = notes.slice(0, 3);

      return (
        <div style={{
          position: "relative", borderRadius: 12, overflow: "hidden",
          marginBottom: 12, height: 140,
          background: mood.g,
        }}>
          {/* Inhalt */}
          <div style={{
            position: "absolute", bottom: 12, left: 14, right: 14,
            display: "flex", justifyContent: "space-between", alignItems: "flex-end",
          }}>
            <span style={{
              fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase",
              background: "rgba(255,255,255,0.22)",
              color: "#fff", padding: "5px 14px", borderRadius: 20,
              fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ fontSize: 14 }}>{mood.icon}</span>
              {family || "Sonstiges"}
            </span>
            {topNotes.length > 0 && (
              <div style={{ display: "flex", gap: 4 }}>
                {topNotes.map((n, i) => (
                  <span key={i} style={{
                    fontSize: 10, color: "rgba(255,255,255,0.85)",
                    background: "rgba(0,0,0,0.15)",
                    padding: "2px 8px", borderRadius: 20,
                  }}>{n.trim()}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    function CostPerWearModal({ perfumeId, perfumeName, wearCount, priceMl, onSavePriceMl, onClose }) {
      useBodyLock(true);
      const data = priceMl[perfumeId] || null;
      const [editing, setEditing] = useState(!data);
      const [price, setPrice] = useState(data?.price ?? "");
      const [ml, setMl] = useState(data?.ml ?? "");

      useEffect(() => {
        const d = priceMl[perfumeId] || null;
        if (d) { setPrice(d.price); setMl(d.ml); setEditing(false); }
        else { setPrice(""); setMl(""); setEditing(true); }
      }, [perfumeId, priceMl]);

      function handleSave() {
        const p = parseFloat(price);
        const m = parseFloat(ml);
        if (!Number.isFinite(p) || p < 0 || !Number.isFinite(m) || m <= 0) return;
        onSavePriceMl(perfumeId, { price: p, ml: m });
        setEditing(false);
      }

      // Stats
      const totalSprays = data ? data.ml * 10 : 0;
      const costPerSpray = data ? data.price / totalSprays : 0;
      const costPerWear = data && wearCount > 0 ? data.price / wearCount : null;
      const spraysUsed = wearCount * 3;
      const spraysLeft = Math.max(0, totalSprays - spraysUsed);
      const pctUsed = totalSprays > 0 ? Math.min(100, (spraysUsed / totalSprays) * 100) : 0;
      const estWearsLeft = spraysLeft > 0 ? Math.floor(spraysLeft / 3) : 0;
      const barColor = pctUsed > 75 ? "#E24B4A" : pctUsed > 50 ? "#BA7517" : "#1D9E75";

      return (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9000,
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          paddingTop: "max(env(safe-area-inset-top),20px)", padding: "max(env(safe-area-inset-top),20px) 16px 16px", overflowY: "auto", overscrollBehavior: "contain"
        }}
          onClick={onClose}>
          <div style={{
            background: "#fff", borderRadius: 12, padding: 20, marginTop: 16,
            maxWidth: 400, width: "100%", maxHeight: "85dvh", overflowY: "auto", WebkitOverflowScrolling: "touch",
            boxShadow: "0 8px 32px rgba(0,0,0,.2)"
          }}
            onClick={function (e) { e.stopPropagation() }}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ ...S.lbl, marginBottom: 2 }}>COST PER WEAR</div>
                <div style={{ fontSize: 14, color: "#1A1A18", fontFamily: "'Georgia',serif" }}>{perfumeName}</div>
              </div>
              <button onClick={onClose} aria-label="Modal schließen"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#B4B2A9", padding: 4 }}>✕</button>
            </div>

            {/* Edit form */}
            {(editing || !data) && (
              <div>
                <div style={{ fontSize: 12, color: "#888780", marginBottom: 12 }}>
                  Preis und Größe eingeben, um die Kosten pro Tragung zu berechnen.
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: "#888780", marginBottom: 4 }}>Preis €</div>
                    <input id="detail-price" type="number" min="0" step="0.01" value={price}
                      onChange={e => setPrice(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSave()}
                      placeholder="0.00" style={{ ...S.inp, fontSize: 13 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: "#888780", marginBottom: 4 }}>Größe ml</div>
                    <input id="detail-size" type="number" min="1" step="1" value={ml}
                      onChange={e => setMl(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSave()}
                      placeholder="100" style={{ ...S.inp, fontSize: 13 }} />
                  </div>
                </div>
                <button onClick={handleSave}
                  disabled={!Number.isFinite(parseFloat(price)) || parseFloat(price) < 0 || !Number.isFinite(parseFloat(ml)) || parseFloat(ml) <= 0}
                  style={{
                    ...S.btn("pri"), width: "100%", fontSize: 13, padding: "10px",
                    opacity: (!Number.isFinite(parseFloat(price)) || parseFloat(price) < 0 || !Number.isFinite(parseFloat(ml)) || parseFloat(ml) <= 0) ? 0.4 : 1
                  }}>
                  Speichern
                </button>
              </div>
            )}

            {/* Stats view */}
            {data && !editing && (
              <div>
                {/* Main stat */}
                <div style={{ textAlign: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 32, fontWeight: 400, color: "#1A1A18", lineHeight: 1 }}>
                    {costPerWear !== null ? `${costPerWear.toFixed(2)} €` : "– €"}
                  </div>
                  <div style={{ fontSize: 11, color: "#888780", marginTop: 4 }}>pro Tragung</div>
                </div>

                {/* Details grid */}
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14,
                  background: "#F1EFE8", borderRadius: 8, padding: "12px 8px"
                }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, color: "#1A1A18" }}>{(+data.price || 0).toFixed(2)} €</div>
                    <div style={{ ...S.lbl, marginBottom: 0 }}>GESAMTPREIS</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, color: "#1A1A18" }}>{costPerSpray.toFixed(3)} €</div>
                    <div style={{ ...S.lbl, marginBottom: 0 }}>PRO SPRAY</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, color: "#1A1A18" }}>{data.ml} ml</div>
                    <div style={{ ...S.lbl, marginBottom: 0 }}>FLAKON</div>
                  </div>
                </div>

                {/* Usage bar */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontSize: 10, color: "#888780" }}>{spraysUsed} / {totalSprays} Sprays</div>
                    <div style={{ fontSize: 10, color: "#888780" }}>{Math.round(pctUsed)}%</div>
                  </div>
                  <div style={{ height: 6, background: "#E8E6E0", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pctUsed}%`, background: barColor, borderRadius: 3, transition: "width .5s" }} />
                  </div>
                </div>

                {/* Remaining */}
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#888780", marginBottom: 14 }}>
                  <span>◎ {spraysLeft} Sprays übrig</span>
                  <span>◎ ~{estWearsLeft} Tragungen</span>
                </div>

                {wearCount === 0 && (
                  <div style={{ fontSize: 10, color: "#BA7517", fontStyle: "italic", marginBottom: 12 }}>
                    Noch keine Tragungen – Cost-per-Wear berechnet sich nach dem ersten „Tragen".
                  </div>
                )}

                <button onClick={() => setEditing(true)}
                  style={{ ...S.btn("out"), width: "100%", fontSize: 13, padding: "10px" }}>
                  Preis / Größe bearbeiten
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: BRAND INFO (Wikipedia)
    // ══════════════════════════════════════════════════════════════════════════════
    const _wikiCache = {};
    async function fetchBrandInfo(brand) {
      if (!brand || brand.trim().length < 2) return null;
      const key = brand.trim().toLowerCase();
      if (_wikiCache[key] !== undefined) return _wikiCache[key];
      if (!getGroqKey()) return null; // kein Key → sofort null, kein Cache-Eintrag
      try {
        const { text } = await groqFetch({
          messages: [
            { role: "system", content: "Parfüm-Experte. Antworte NUR mit 2-3 Sätzen auf Deutsch: Gründer, Jahr, Land, bekannter Duft. Kein Markdown." },
            { role: "user", content: `Marke: ${brand}` },
          ],
          temperature: 0.4, max_tokens: 120,
          cacheKey: "brand:" + key,
        });
        if (text && text.length > 15) {
          const result = { text, url: null };
          _wikiCache[key] = result;
          return result;
        }
        _wikiCache[key] = null;
        return null;
      } catch(err) {
        // Nur bei dauerhaften Fehlern (kein Key, 404) cachen – nicht bei Rate-Limit oder Netzwerk
        const msg = err?.message || "";
        const isPermanent = msg.includes("API-Schlüssel") || msg.includes("API-Key") || msg.includes("401");
        if (isPermanent) _wikiCache[key] = null;
        // Bei Rate-Limit oder Netzwerkfehler: nicht cachen → nächster Versuch klappt evtl.
        return null;
      }
    }

    function BrandInfo({ house }) {
      const [info, setInfo] = useState(null);
      const [expanded, setExpanded] = useState(false);
      const [loading, setLoading] = useState(false);
      const [errMsg, setErrMsg] = useState("");
      const houseRef = useRef(house);

      useEffect(() => {
        houseRef.current = house;
        setInfo(null);
        setExpanded(false);
        setErrMsg("");
      }, [house]);

      async function handleToggle() {
        if (expanded && info) { setExpanded(false); return; }
        setExpanded(true);
        if (info || !house) return;
        if (!getGroqKey()) {
          setErrMsg("Kein Groq API-Key – bitte unter Settings → API eintragen.");
          return;
        }
        setLoading(true); setErrMsg("");
        try {
          const result = await fetchBrandInfo(house);
          if (houseRef.current === house) {
            if (result) setInfo(result);
            else setErrMsg("Keine Infos gefunden – bitte nochmal versuchen.");
          }
        } catch(e) {
          if (houseRef.current === house) setErrMsg(e.message || "Fehler beim Laden.");
        }
        setLoading(false);
      }

      async function handleRetry() {
        const key = house.trim().toLowerCase();
        delete _wikiCache[key];
        setInfo(null); setErrMsg(""); setLoading(true);
        try {
          const result = await fetchBrandInfo(house);
          if (houseRef.current === house) {
            if (result) setInfo(result);
            else setErrMsg("Keine Infos gefunden.");
          }
        } catch(e) {
          if (houseRef.current === house) setErrMsg(e.message || "Fehler beim Laden.");
        }
        setLoading(false);
      }

      if (!house) return null;

      return (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <input value={house} readOnly
              style={{
                fontSize: 12, color: "#5F5E5A", border: "none", background: "transparent",
                padding: 0, fontFamily: "'Georgia',serif", width: "auto", flex: "none",
                outline: "none", cursor: "default", WebkitUserSelect: "none", userSelect: "none"
              }} />
            <button onClick={handleToggle}
              style={{
                background: "none", border: "1px solid #D3D1C7", borderRadius: "50%",
                width: 18, height: 18, minWidth: 18, minHeight: 18, aspectRatio: "1 / 1", cursor: "pointer", display: "inline-flex",
                alignItems: "center", justifyContent: "center", fontSize: 10,
                color: expanded ? "#534AB7" : "#B4B2A9", lineHeight: 1, padding: 0,
                transition: "all .15s", flexShrink: 0, boxSizing: "content-box"
              }}
              onMouseEnter={function (e) { e.currentTarget.style.borderColor = "#534AB7"; e.currentTarget.style.color = "#534AB7" }}
              onMouseLeave={function (e) { e.currentTarget.style.borderColor = "#D3D1C7"; e.currentTarget.style.color = expanded ? "#534AB7" : "#B4B2A9" }}>
              i
            </button>
          </div>
          {expanded && (
            <div style={{
              marginTop: 8, padding: "10px 12px", background: "#F1EFE8", borderRadius: 8,
              fontSize: 12, color: "#5F5E5A", lineHeight: 1.6, animation: "fadeIn .3s"
            }}>
              {loading ? (
                <span style={{ color: "#B4B2A9", fontStyle: "italic" }}>Lade Hintergrundinfo…</span>
              ) : info ? (
                <div>{info.text}</div>
              ) : errMsg ? (
                <div>
                  <div style={{ color: "#B4B2A9", fontStyle: "italic", marginBottom: errMsg.includes("Settings") ? 0 : 6 }}>{errMsg}</div>
                  {!errMsg.includes("Settings") && (
                    <button onClick={handleRetry} style={{ ...S.btn("out"), fontSize: 11, padding: "4px 10px" }}>
                      Nochmal versuchen
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: FUN FACTS (Groq)
    // ══════════════════════════════════════════════════════════════════════════════
    const _factsCache = {};
    async function fetchFunFacts(name, house, top, middle, base, extra = {}) {
      if (!name) return null;
      // Cache-Key inkludiert Noten-Fingerprint → neue Noten = neue Facts
      const noteStr = [top, middle, base].filter(Boolean).join(", ").slice(0, 300);
      const noteHash = noteStr.slice(0, 40).replace(/\s/g, "");
      const key = `${house || ""}::${name}::${noteHash}`.toLowerCase();
      if (_factsCache[key] !== undefined) return _factsCache[key];
      if (!getGroqKey()) return null;

      // Zusatzinfos für präziseren Prompt
      const { conc, family, season, gender } = extra;
      const contextParts = [
        conc && `Konzentration: ${conc}`,
        family && `Familie: ${family}`,
        season && `Saison: ${season}`,
        gender && `Zielgruppe: ${gender}`,
      ].filter(Boolean).join(", ");

      const systemPrompt = `Du bist ein Parfüm-Experte. Gib genau 3 Fun-Facts auf Deutsch über das angegebene Parfüm.
Jeder Fact auf einer eigenen Zeile, kein Bullet-Point, kein Markdown.
Fokus: einzigartige Details die DIESEN Duft charakterisieren – Perfumeur, Inspiration, markante Noten-Kombination, Geschichte, Besonderheit.
Keine allgemeinen Aussagen über die Marke. Keine Wiederholung der Noten-Liste. Jeder Fact soll überraschen.`;

      const userPrompt = [
        `Parfüm: ${house ? house + " – " : ""}${name}`,
        contextParts && `Kontext: ${contextParts}`,
        noteStr && `Noten: ${noteStr}`,
      ].filter(Boolean).join("\n");

      try {
        const { text } = await groqFetch({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7, max_tokens: 180,
          cacheKey: "facts2:" + key.slice(0, 80),
        });
        if (text && text.length > 20) {
          _factsCache[key] = text;
          return text;
        }
        _factsCache[key] = null;
        return null;
      } catch(err) {
        const msg = err?.message || "";
        const isPermanent = msg.includes("API-Schlüssel") || msg.includes("API-Key") || msg.includes("401");
        if (isPermanent) { _factsCache[key] = null; return null; }
        // Transiente Fehler (Rate-Limit, Netzwerk) hochwerfen, damit UI sie anzeigt
        throw err;
      }
    }

    function FunFactsCard({ name, house, top, middle, base, conc, family, season, gender }) {
      const [facts, setFacts] = useState(null);
      const [loading, setLoading] = useState(false);
      const [expanded, setExpanded] = useState(false);
      const [errMsg, setErrMsg] = useState("");
      const nameRef = useRef(name);
      const extra = { conc, family, season, gender };

      // Reset wenn Name ODER Noten sich ändern (neue Noten = neue Facts)
      const noteFingerprint = [top, middle, base].filter(Boolean).join("|");
      useEffect(() => {
        nameRef.current = name;
        setFacts(null);
        setExpanded(false);
        setErrMsg("");
      }, [name, noteFingerprint]);

      async function handleLoad() {
        if (expanded && facts) { setExpanded(false); return; }
        setExpanded(true);
        if (facts) return;
        if (!getGroqKey()) {
          setErrMsg("Kein Groq API-Key – bitte unter Settings → API eintragen.");
          return;
        }
        setLoading(true); setErrMsg("");
        try {
          const result = await fetchFunFacts(name, house, top, middle, base, extra);
          if (nameRef.current === name) {
            if (result) setFacts(result);
            else setErrMsg("Keine Antwort von der KI – bitte nochmal versuchen.");
          }
        } catch(e) {
          if (nameRef.current === name) {
            const msg = e.message || "";
            const rlMatch = msg.match(/RATE_LIMIT:(\d+)/);
            if (rlMatch) setErrMsg(`API-Limit erreicht – bitte in ${rlMatch[1]}s erneut versuchen.`);
            else if (msg.includes("API-Limit")) setErrMsg(msg);
            else setErrMsg("KI momentan nicht erreichbar – bitte nochmal versuchen.");
          }
        }
        setLoading(false);
      }

      async function handleRetry() {
        // Cache-Key muss mit neuem noteHash übereinstimmen → fetchFunFacts berechnet ihn intern
        const noteStr = [top, middle, base].filter(Boolean).join(", ").slice(0, 300);
        const noteHash = noteStr.slice(0, 40).replace(/\s/g, "");
        const key = `${house || ""}::${name}::${noteHash}`.toLowerCase();
        delete _factsCache[key];
        setFacts(null); setErrMsg(""); setLoading(true);
        try {
          const result = await fetchFunFacts(name, house, top, middle, base, extra);
          if (nameRef.current === name) {
            if (result) setFacts(result);
            else setErrMsg("Keine Antwort von der KI – bitte nochmal versuchen.");
          }
        } catch(e) {
          if (nameRef.current === name) {
            const msg = e.message || "";
            const rlMatch = msg.match(/RATE_LIMIT:(\d+)/);
            if (rlMatch) setErrMsg(`API-Limit erreicht – bitte in ${rlMatch[1]}s erneut versuchen.`);
            else if (msg.includes("API-Limit")) setErrMsg(msg);
            else setErrMsg("KI momentan nicht erreichbar – bitte nochmal versuchen.");
          }
        }
        setLoading(false);
      }

      if (!name) return null;

      return (
        <div style={{ ...S.card, marginBottom: 12 }}>
          <button onClick={handleLoad} aria-expanded={expanded}
            style={{
              background: "none", border: "none", cursor: "pointer", width: "100%",
              display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14 }} aria-hidden="true">✦</span>
              <div style={S.lbl}>FUN FACTS</div>
            </div>
            <span style={{
              fontSize: 12, color: "#B4B2A9", transition: "transform .2s",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)"
            }} aria-hidden="true">▾</span>
          </button>
          {expanded && (
            <div style={{
              marginTop: 10, paddingTop: 10, borderTop: "1px solid #F1EFE8",
              animation: "fadeIn .3s"
            }}>
              {loading ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
                  <span style={{ fontSize: 11, color: "#B4B2A9", animation: "pulse 1.2s ease-in-out infinite" }}>✦</span>
                  <span style={{ fontSize: 12, color: "#B4B2A9", fontStyle: "italic" }}>Sammle Facts zu diesem Duft…</span>
                </div>
              ) : facts ? (
                <div>
                  {facts.split("\n").filter(s => s.trim()).map((s, i) => {
                    const text = s.replace(/^[\d.\-•·]+\s*/, "").trim();
                    if (!text) return null;
                    return (
                      <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 10, color: "#534AB7", flexShrink: 0, marginTop: 3, fontWeight: 700 }}>
                          {["✦", "◎", "→"][i] || "·"}
                        </span>
                        <span style={{ fontSize: 13, color: "#1A1A18", lineHeight: 1.65 }}>{text}</span>
                      </div>
                    );
                  })}
                  <button onClick={handleRetry} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", fontFamily: "inherit", padding: "4px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                    <span>↻</span><span>Neue Facts laden</span>
                  </button>
                </div>
              ) : errMsg ? (
                <div>
                  <div style={{ fontSize: 12, color: "#B4B2A9", fontStyle: "italic", marginBottom: 6 }}>{errMsg}</div>
                  {!errMsg.includes("Settings") && (
                    <button onClick={handleRetry} style={{ ...S.btn("out"), fontSize: 11, padding: "5px 12px" }}>
                      Nochmal versuchen
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // FEATURE: SPOTIFY CARD
    // ══════════════════════════════════════════════════════════════════════════════
    function getSpotifyEmbedUrl(url) {
      if (!url) return null;
      const m = url.match(/open\.spotify\.com\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/);
      if (!m) return null;
      return `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0`;
    }
    function getSpotifyOpenUrl(url) {
      if (!url) return null;
      const m = url.match(/open\.spotify\.com\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/);
      if (!m) return null;
      return `https://open.spotify.com/${m[1]}/${m[2]}`;
    }

    function SpotifyCard({ spotifyUrl, onEdit }) {
      const openUrl = getSpotifyOpenUrl(spotifyUrl);

      if (openUrl) {
        return (
          <div style={{ marginBottom: 10 }}>
            <a href={openUrl} target="_blank" rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "8px 14px", borderRadius: 10,
                background: "#1DB954", color: "#fff", textDecoration: "none",
                fontSize: 12, fontWeight: 500, transition: "all .3s cubic-bezier(0.25,.46,.45,.94)",
                transform: "translateY(0)", boxShadow: "0 2px 8px rgba(29,185,84,0.3)"
              }}
              onMouseEnter={function (e) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 15px rgba(29,185,84,0.4)" }}
              onMouseLeave={function (e) { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(29,185,84,0.3)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              Spotify
            </a>
            <button onClick={onEdit} aria-label="Spotify-URL bearbeiten"
              style={{
                background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9",
                padding: "8px 0 0 2px", marginLeft: 4, transition: "color .12s"
              }}
              onMouseEnter={function (e) { e.currentTarget.style.color = "#534AB7" }}
              onMouseLeave={function (e) { e.currentTarget.style.color = "#B4B2A9" }}>
              ändern
            </button>
          </div>
        );
      }

      return (
        <div style={{ marginBottom: 10 }}>
          <button onClick={onEdit} aria-label="Soundtrack hinzufügen"
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "8px 14px", borderRadius: 10,
              border: "1px dashed #D3D1C7", background: "transparent",
              color: "#B4B2A9", fontSize: 12, cursor: "pointer",
              transition: "all .15s", fontFamily: "'Georgia',serif"
            }}
            onMouseEnter={function (e) { e.currentTarget.style.borderColor = "#1DB954"; e.currentTarget.style.color = "#1DB954"; }}
            onMouseLeave={function (e) { e.currentTarget.style.borderColor = "#D3D1C7"; e.currentTarget.style.color = "#B4B2A9"; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity=".5" aria-hidden="true" focusable="false">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            Soundtrack hinzufügen
          </button>
        </div>
      );
    }

    function NotesEditModal({ perfume, onClose, onUpdate, onSaveNote, localNotes, onSearchNote, removeTag, addTag, noteInput, setNoteInput }) {
      useBodyLock(true);
      const [local, setLocal] = useState({ ...perfume });

      function setField(k, v) {
        setLocal(prev => ({ ...prev, [k]: v }));
      }
      function handleSave() {
        const patch = {};
        ["house", "families", "season", "top", "middle", "base", "spotify_url"].forEach(k => {
          const oldVal = perfume[k];
          const newVal = local[k];
          const changed = (Array.isArray(newVal) || Array.isArray(oldVal))
            ? JSON.stringify(newVal || []) !== JSON.stringify(oldVal || [])
            : newVal !== oldVal;
          if (changed) patch[k] = newVal;
        });
        if (Object.keys(patch).length > 0) onUpdate(perfume.id, patch);
        onClose();
      }

      return (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9000,
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          padding: "env(safe-area-inset-top,16px) 16px 16px", paddingTop: "max(env(safe-area-inset-top),20px)", overflowY: "auto", overscrollBehavior: "contain"
        }}
          onClick={onClose}>
          <div style={{
            background: "#fff", borderRadius: 12, padding: 20,
            maxWidth: 420, width: "100%", maxHeight: "85dvh", overflowY: "auto",
            WebkitOverflowScrolling: "touch", marginTop: 16,
            boxShadow: "0 8px 32px rgba(0,0,0,.2)"
          }}
            onClick={function (e) { e.stopPropagation() }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ ...S.lbl, marginBottom: 0 }}>DUFTDATEN BEARBEITEN</div>
              <button onClick={onClose} aria-label="Modal schließen"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#B4B2A9", padding: 4 }}>✕</button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label htmlFor="note-house" style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>Haus / Marke</label>
              <input id="note-house" value={local.house || ""} onChange={e => setField("house", e.target.value)}
                placeholder="z.B. Bon Parfumeur" style={{ ...S.inp, fontSize: 12 }} />
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: "#888780", marginBottom: 6, display: "block" }}>
                  Familien · Reihenfolge = Priorität (#8)
                </label>
                {/* Ausgewählte Familien als geordnete Liste mit Prioritäts-Badges */}
                {(local.families && local.families.length > 0) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                    {local.families.map((fam, idx) => {
                      const col = FAM_COLORS[fam] || "#534AB7";
                      const priorityLabel = idx === 0 ? "1. Hauptfamilie" : idx === 1 ? "2. Nebenfamilie" : "3. weitere";
                      const weights = ["1.0×", "0.5×", "0.25×"];
                      return (
                        <div key={fam} style={{ display: "flex", alignItems: "center", gap: 3, background: col + "18", border: `1px solid ${col}`, borderRadius: 16, padding: "3px 8px 3px 4px" }}>
                          <span style={{ fontSize: 9, background: col, color: "#fff", borderRadius: "50%", width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 700 }}>{idx + 1}</span>
                          <span style={{ fontSize: 11, color: col }}>{fam}</span>
                          <span style={{ fontSize: 9, color: col, opacity: 0.7 }}>{weights[idx] || "0.1×"}</span>
                          <button type="button" onClick={e => { e.stopPropagation(); setField("families", local.families.filter(f => f !== fam)); }}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, color: col, padding: "0 0 0 2px", lineHeight: 1 }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 6 }}>
                  Tippen zum Hinzufügen · erste Auswahl = Hauptfamilie (volle Gewichtung)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {[...FAMILIES].filter(fam => !(local.families || []).includes(fam)).sort((a, b) => a.localeCompare(b)).map(fam => {
                    const col = FAM_COLORS[fam] || "#534AB7";
                    return (
                      <button key={fam} type="button" onClick={(e) => {
                        e.stopPropagation();
                        setField("families", [...(local.families || []), fam]);
                      }} style={{
                        fontSize: 11, padding: "3px 9px", borderRadius: 14,
                        border: "1px solid #E8E6E0",
                        background: "#fff", color: "#888780", cursor: "pointer",
                        transition: "all .12s",
                      }}>{fam}</button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="note-season" style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>Saison</label>
                <select id="note-season" value={local.season || "Ganzjährig"} onChange={e => setField("season", e.target.value)}
                  style={{ ...S.inp, fontSize: 12, padding: "8px", width: "100%" }}>
                  {SEASONS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {[["Kopfnoten", "top"], ["Herznoten", "middle"], ["Basisnoten", "base"]].map(([label, key]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label htmlFor={`note-${key}`} style={{ fontSize: 10, color: "#888780", marginBottom: 4, display: "block" }}>{label}</label>
                <textarea id={`note-${key}`} value={local[key] || ""} onChange={e => setField(key, e.target.value)}
                  style={{ ...S.ta, minHeight: 52, fontSize: 12 }} />
              </div>
            ))}

            <div style={{ borderTop: "1px solid #F1EFE8", paddingTop: 10, marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <label htmlFor="note-tag-input" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Tag eingeben</label>
                <input id="note-tag-input" value={noteInput} onChange={e => setNoteInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  placeholder="Tag hinzufügen…" style={{ ...S.inp, flex: 1, fontSize: 12 }} />
                <button onClick={addTag} aria-label="Tag hinzufügen" style={{ ...S.btn("pri"), padding: "8px 12px" }}>+</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="list" aria-label="Notiz-Tags">
                {localNotes.map(t => (
                  <span key={t} role="listitem" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 20, background: "#F1EFE8", fontSize: 12 }}>
                    <button onClick={() => onSearchNote && onSearchNote(t)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12 }}>{t}</button>
                    <button onClick={() => removeTag(t)} aria-label={`Tag "${t}" entfernen`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#888780" }}>✕</button>
                  </span>
                ))}
                {localNotes.length === 0 && <div style={{ fontSize: 11, color: "#888780" }}>Noch keine Tags</div>}
              </div>
            </div>

            <div style={{ borderTop: "1px solid #F1EFE8", paddingTop: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#888780", marginBottom: 4 }}>Spotify-URL (Track oder Playlist)</div>
              <input id="note-spotify" value={local.spotify_url || ""} onChange={e => setField("spotify_url", e.target.value)}
                placeholder="https://open.spotify.com/track/…" style={{ ...S.inp, fontSize: 12 }} />
            </div>

            <button onClick={handleSave} style={{ ...S.btn("pri"), width: "100%", fontSize: 13, padding: "10px" }}>
              Speichern
            </button>
          </div>
        </div>
      );
    }

    function CostPerWearButton({ perfumeId, wearCount, priceMl, onClick }) {
      const data = priceMl[perfumeId] || null;
      const cpw = data && wearCount > 0 ? (data.price / wearCount).toFixed(2) : null;

      return (
        <button onClick={onClick} aria-label={data ? `Kosten: ${cpw || data.price.toFixed(2)} Euro pro Tragung` : "Preis hinzufügen"}
          style={{
            background: "none", border: "1px solid #D3D1C7", borderRadius: 8, cursor: "pointer",
            padding: "6px 10px", fontSize: 11, fontFamily: "'Georgia',serif", color: "#888780",
            display: "inline-flex", alignItems: "center", gap: 4, transition: "all .12s"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.borderColor = "#BA7517"; e.currentTarget.style.color = "#BA7517"; }}
          onMouseLeave={function (e) { e.currentTarget.style.borderColor = "#D3D1C7"; e.currentTarget.style.color = "#888780"; }}>
          {data ? (
            <>{cpw !== null ? `${cpw} €/Trag` : `${(+data.price || 0).toFixed(2)} €`} · {data.ml}ml</>
          ) : (
            <>Preis hinzufügen</>
          )}
        </button>
      );
    }

    const FIELD_LABELS = { name:"Name", house:"Haus", conc:"Konzentration", family:"Familie",
      top:"Kopfnoten", middle:"Herznoten", base:"Basisnoten", season:"Saison", gender:"Geschlecht" };

    function ReloadDiffModal({ reloadDiff, onApply, onClose }) {
      useBodyLock(true);
      const [selected, setSelected] = useState(() => new Set(reloadDiff.map(d => d.field)));
      const toggle = f => setSelected(prev => { const s = new Set(prev); s.has(f) ? s.delete(f) : s.add(f); return s; });
      return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9200,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={onClose}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, maxWidth: 420, width: "100%",
            maxHeight: "80dvh", animation: "scaleIn .2s cubic-bezier(0.25,0.46,0.45,0.94) both", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            fontFamily: "'Georgia',serif"
          }}>
            {/* Header */}
            <div style={{ background: "linear-gradient(135deg, #1A1A18 0%, #534AB7 100%)", borderRadius: "20px 20px 0 0", padding: "20px 24px 16px" }}>
              <div style={{ fontSize: 10, letterSpacing: "1.5px", color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>PARFUMO ABGLEICH</div>
              <div style={{ fontSize: 18, color: "#fff", fontWeight: 400 }}>{reloadDiff.length} Änderung{reloadDiff.length !== 1 ? "en" : ""} gefunden</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>Wähle aus, was übernommen werden soll.</div>
            </div>
            <div style={{ padding: "20px 24px" }}>
              {reloadDiff.map(d => (
                <div key={d.field} onClick={() => toggle(d.field)}
                  style={{
                    padding: "12px 14px", marginBottom: 8, borderRadius: 12, cursor: "pointer",
                    border: selected.has(d.field) ? "1.5px solid #534AB7" : "1px solid #E8E6E0",
                    background: selected.has(d.field) ? "#F4F3FD" : "#FAFAF8",
                    transition: "all .15s"
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 10, letterSpacing: "1px", color: selected.has(d.field) ? "#534AB7" : "#B4B2A9" }}>
                      {FIELD_LABELS[d.field] || d.field}
                    </span>
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${selected.has(d.field) ? "#534AB7" : "#D3D1C7"}`,
                      background: selected.has(d.field) ? "#534AB7" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                    }}>
                      {selected.has(d.field) && <span style={{ fontSize: 10, color: "#fff" }}>✓</span>}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                    <div>
                      <div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>AKTUELL</div>
                      <div style={{ color: "#888780", fontStyle: d.old ? "normal" : "italic" }}>{d.old || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#1D9E75", marginBottom: 2 }}>NEU VON PARFUMO</div>
                      <div style={{ color: "#1A1A18", fontWeight: 500 }}>{d.fresh || "—"}</div>
                    </div>
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginBottom: 16, marginTop: 4 }}>
                <button onClick={() => setSelected(new Set(reloadDiff.map(d => d.field)))}
                  style={{ ...S.btn("out"), flex: 1, fontSize: 11, padding: "8px" }}>Alle</button>
                <button onClick={() => setSelected(new Set())}
                  style={{ ...S.btn("out"), flex: 1, fontSize: 11, padding: "8px" }}>Keine</button>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => onApply([...selected])}
                  disabled={selected.size === 0}
                  style={{ ...S.btn("pri"), flex: 2, padding: "14px", borderRadius: 10, fontSize: 13,
                    opacity: selected.size === 0 ? 0.4 : 1,
                    boxShadow: "0 2px 8px rgba(83,74,183,0.25)" }}>
                  {selected.size} Feld{selected.size !== 1 ? "er" : ""} übernehmen
                </button>
                <button onClick={onClose}
                  style={{ ...S.btn("out"), flex: 1, padding: "14px", borderRadius: 10, fontSize: 13 }}>
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    function DetailView({ perfume, items, log, notes, onClose, onDelete, onUpdate, onSaveNote, onLog, onSearchNote, fillLevels, onSetFill, priceMl, onSavePriceMl, containerRef }) {
      const rootRef = useRef(null);
      function openOverlay(setter) {
        const fixedEl = containerRef?.current; // App-Level: eigener fixed container
        if (fixedEl) {
          // Statistik/Heute/Ordner: fixed div scrollen
          if (fixedEl.scrollTop > 10) {
            fixedEl.scrollTo({ top: 0, behavior: 'smooth' });
            setTimeout(() => setter(true), 120);
          } else {
            setter(true);
          }
        } else {
          // SammlungTab: scrollbarer Container ist PullToRefresh-Div
          const mainEl = document.getElementById('main-scroll-container');
          const scrollEl = mainEl || window;
          const scrollTop = mainEl ? mainEl.scrollTop : window.scrollY;
          if (scrollTop > 10) {
            scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
            setTimeout(() => setter(true), 120);
          } else {
            setter(true);
          }
        }
      }
      const [local, setLocal] = useState(perfume);
      const [localNotes, setLocalNotes] = useState(Array.isArray(notes?.[perfume.id]) ? notes[perfume.id] : []);
      const [noteInput, setNoteInput] = useState("");
      const [showCpw, setShowCpw] = useState(false);
      const [showNotes, setShowNotes] = useState(false);
      const [showJournal, setShowJournal] = useState(false);
      const [journalText, setJournalText] = useState(local.journal || "");
      const [showConfirmDelete, setShowConfirmDelete] = useState(false);
      // ── Declutter-Kategorie (Verkaufen/Verschenken) aus DetailView ──
      const [declCategory, setDeclCategory] = useState(() => {
        try {
          const all = JSON.parse(localStorage.getItem(KEYS.declutterStatus) || "{}");
          return all[perfume.id] || null;
        } catch { return null; }
      });
      const [declToast, setDeclToast] = useState("");
      function saveDeclCategory(cat) {
        try {
          const all = JSON.parse(localStorage.getItem(KEYS.declutterStatus) || "{}");
          if (cat) all[perfume.id] = cat;
          else delete all[perfume.id];
          localStorage.setItem(KEYS.declutterStatus, JSON.stringify(all));
        } catch {}
        setDeclCategory(cat);
        if (cat) {
          setDeclToast(cat === "Verkaufen" ? "💰 Als Verkaufen markiert" : cat === "Verschenken" ? "🎁 Als Verschenken markiert" : "🏠 Behalten");
          setTimeout(() => setDeclToast(""), 2200);
        }
      }
      // ── Reload-State ──
      const [reloadState, setReloadState] = useState("idle"); // idle | loading | diff | error
      const [reloadDiff, setReloadDiff] = useState(null);   // { field, old, new }[]
      const [reloadData, setReloadData] = useState(null);
      const [reloadErr, setReloadErr] = useState("");
      useBodyLock(showCpw || showNotes || showJournal || showConfirmDelete || reloadState === "diff");

      async function handleReload() {
        if (!local.url) return;
        setReloadState("loading"); setReloadErr(""); setReloadDiff(null); setReloadData(null);
        try {
          const fresh = await lookupByUrl(local.url);
          const COMPARE_FIELDS = ["name","house","conc","family","top","middle","base","season","gender"];
          const diffs = COMPARE_FIELDS.filter(f => {
            const oldV = (local[f] || "").toString().trim();
            const newV = (fresh[f] || "").toString().trim();
            return oldV !== newV && newV !== "";
          }).map(f => ({ field: f, old: (local[f] || ""), fresh: (fresh[f] || "") }));
          if (diffs.length === 0) {
            setReloadState("idle");
            setReloadErr("✓ Alle Daten sind bereits aktuell.");
            setTimeout(() => setReloadErr(""), 3000);
          } else {
            setReloadDiff(diffs);
            setReloadData(fresh);
            setReloadState("diff");
          }
        } catch(e) {
          setReloadState("error");
          setReloadErr(e.message || "Unbekannter Fehler");
          setTimeout(() => setReloadState("idle"), 4000);
        }
      }

      function applyReload(selectedFields) {
        const patch = {};
        selectedFields.forEach(f => { patch[f] = reloadData[f]; });
        onUpdate(perfume.id, patch);
        setLocal(prev => ({ ...prev, ...patch }));
        setReloadState("idle"); setReloadDiff(null); setReloadData(null);
      }

      const safeLog = Array.isArray(log) ? log : [];
      const wearCount = safeLog.filter(l => l && l.id === perfume.id).length;
      const lastWear = safeLog.filter(l => l && l.id === perfume.id).sort((a, b) => (b?.ts || 0) - (a?.ts || 0))[0];
      const lastWearText = lastWear ? new Date(lastWear.ts).toLocaleDateString("de-DE") : "Noch nie";

      useEffect(() => { setLocal(perfume); }, [perfume]);
      useEffect(() => { setLocalNotes(Array.isArray(notes?.[perfume.id]) ? notes[perfume.id] : []); }, [notes, perfume.id]);

      function setFieldLocal(k, v) { setLocal(prev => ({ ...prev, [k]: v })); }
      function commitField(k) {
        onUpdate(perfume.id, { [k]: local[k] });
      }
      function addTag() {
        const t = noteInput.trim();
        if (!t) return;
        const next = [...new Set([...localNotes, t])];
        setLocalNotes(next);
        onSaveNote(perfume.id, next);
        setNoteInput("");
      }
      function removeTag(t) {
        const next = localNotes.filter(x => x !== t);
        setLocalNotes(next);
        onSaveNote(perfume.id, next);
      }

      // Normal React rendering - matches original src/components/DetailView.jsx
      return (
        <div ref={rootRef} style={{ fontFamily: "'Georgia',serif", background: "#FAFAF8", color: "#1A1A18", minHeight: "100%", paddingBottom: "5rem" }}>
          <button onClick={onClose} style={{ ...S.btn("out"), marginBottom: 12 }}>← Zurück</button>

          {/* ── Declutter-Kategorie Badge (Frage 1) ─────────────────────────────── */}
          {declToast && (
            <div style={{
              position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
              background: "#1A1A18", color: "#fff", padding: "10px 20px", borderRadius: 20,
              fontSize: 12, zIndex: 9999, animation: "fadeIn .2s ease-out", whiteSpace: "nowrap",
              boxShadow: "0 4px 20px rgba(26,26,24,.25)"
            }}>{declToast}</div>
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#B4B2A9", flexShrink: 0 }}>Kategorie:</span>
            {[
              { id: "Behalten", icon: "🏠", color: "#1D9E75" },
              { id: "Verkaufen", icon: "💰", color: "#534AB7" },
              { id: "Verschenken", icon: "🎁", color: "#993C1D" },
            ].map(cat => {
              const isActive = declCategory === cat.id;
              return (
                <button key={cat.id} onClick={() => saveDeclCategory(isActive ? null : cat.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
                    borderRadius: 16, border: `1px solid ${isActive ? cat.color : "#E8E6E0"}`,
                    background: isActive ? cat.color + "18" : "transparent",
                    color: isActive ? cat.color : "#888780", fontSize: 11, cursor: "pointer",
                    transition: "all .2s", fontFamily: "'Georgia',serif"
                  }}>
                  <span style={{ fontSize: 13 }}>{cat.icon}</span>
                  <span>{cat.id}</span>
                </button>
              );
            })}
          </div>

          <MoodHeader family={local.family} base={local.base} />
          <div style={{ ...S.card, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input value={local.name || ""} onChange={e => setFieldLocal("name", e.target.value)} onBlur={() => commitField("name")}
                  style={{ ...S.inp, fontSize: 16, fontWeight: 500, marginBottom: 6 }} />
                <BrandInfo house={local.house} />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, marginBottom: 8 }}>
                  <span style={S.pill("#534AB7")}>{local.conc || "?"}</span>
                  <span style={S.pill("#888")}>{local.format || "?"}</span>
                  {((local.families && local.families.length > 0) ? local.families : [local.family || "Sonstiges"]).map((f, idx) => (
                    <span key={f} style={idx === 0 ? S.pill(FAM_COLORS[f] || "#888") : { fontSize: 9, padding: "2px 8px", borderRadius: 12, border: `1px solid ${FAM_COLORS[f] || "#888"}`, background: "transparent", color: FAM_COLORS[f] || "#888", fontWeight: 400 }}>{f}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                <Stars rating={local.rating || 0} onSet={n => { setFieldLocal("rating", n); onUpdate(perfume.id, { rating: n }); }} size={18} />
                <button onClick={e => { onLog(local); triggerSprayAnimation(e.currentTarget); }} style={{ ...S.btn("pri"), fontSize: 11, padding: "6px 10px" }}>Tragen</button>
                {local.url && (
                  <button onClick={handleReload} disabled={reloadState === "loading"}
                    title="Noten & Daten von Parfumo neu laden"
                    style={{
                      ...S.btn("out"), fontSize: 11, padding: "6px 10px",
                      opacity: reloadState === "loading" ? 0.5 : 1,
                      color: reloadState === "error" ? "#E24B4A" : "#888780",
                      borderColor: reloadState === "error" ? "#E24B4A" : "#D3D1C7",
                      transition: "all .2s"
                    }}>
                    {reloadState === "loading" ? "…" : "↻"}
                  </button>
                )}
                {reloadErr && (
                  <div style={{ fontSize: 11, color: reloadErr.startsWith("✓") ? "#1D9E75" : "#E24B4A", marginTop: 4, flex: "1 1 100%" }}>
                    {reloadErr}
                  </div>
                )}
              </div>
            </div>
            <FillLevelEditor item={local} fillLevels={fillLevels || {}} onSetFill={onSetFill} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <div style={{ fontSize: 10, color: "#888780" }}>Getragen: {wearCount}× · Zuletzt: {lastWearText}</div>
              <CostPerWearButton perfumeId={perfume.id} wearCount={wearCount} priceMl={priceMl || {}} onClick={() => openOverlay(setShowCpw)} />
            </div>
            {/* Spotify */}
            <div style={{ marginTop: 8 }}>
              {getSpotifyOpenUrl(local.spotify_url) ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <a href={getSpotifyOpenUrl(local.spotify_url) || "#"} target="_blank" rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      padding: "8px 14px", borderRadius: 10, background: "#1DB954", color: "#fff",
                      textDecoration: "none", fontSize: 12, fontWeight: 500, fontFamily: "'Georgia',serif"
                    }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
                    Spotify öffnen
                  </a>
                  <button onClick={() => openOverlay(setShowNotes)} aria-label="Spotify-URL bearbeiten"
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", padding: 0 }}>
                    ändern
                  </button>
                </div>
              ) : (
                <button onClick={() => openOverlay(setShowNotes)} aria-label="Soundtrack hinzufügen"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    padding: "8px 14px", borderRadius: 10, border: "1px dashed #D3D1C7",
                    background: "none", color: "#B4B2A9", fontSize: 12, cursor: "pointer",
                    fontFamily: "'Georgia',serif"
                  }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#B4B2A9" aria-hidden="true" focusable="false"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
                  Soundtrack hinzufügen
                </button>
              )}
            </div>
          </div>

          {showCpw && <CostPerWearModal perfumeId={perfume.id} perfumeName={local.name || ""} wearCount={wearCount} priceMl={priceMl || {}} onSavePriceMl={onSavePriceMl} onClose={() => setShowCpw(false)} />}

          <FunFactsCard name={local.name} house={local.house} top={local.top} middle={local.middle} base={local.base} conc={local.conc} family={local.family} season={local.season} gender={local.gender} />

          <div style={{ ...S.card, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={S.lbl}>DETAILS & NOTIZEN</div>
              <button onClick={() => openOverlay(setShowNotes)} aria-label="Details bearbeiten"
                style={{
                  background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9", padding: 2,
                  transition: "color .12s"
                }}
                onMouseEnter={function (e) { e.currentTarget.style.color = "#534AB7" }}
                onMouseLeave={function (e) { e.currentTarget.style.color = "#B4B2A9" }}
                title="Bearbeiten">✎</button>
            </div>
            {/* Familie + Saison */}
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ ...S.pill(FAM_COLORS[local.family] || "#888"), fontSize: 10 }}>{local.family || "Sonstiges"}</span>
              <span style={{ fontSize: 10, color: "#888780", padding: "3px 0" }}>{local.season || "Ganzjährig"}</span>
              {(local.note_categories || []).map(c => (
                <span key={c} style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 20,
                  background: (NOTE_CAT_COLORS[c] || "#888780") + "18", color: NOTE_CAT_COLORS[c] || "#888780"
                }}>{c}</span>
              ))}
            </div>
            {/* Noten prominent */}
            {[["☀", "Kopfnoten", local.top, "#BA7517"], ["♥", "Herznoten", local.middle, "#9B4D8C"], ["◎", "Basisnoten", local.base, "#5C6B4F"]].map(([icon, label, notes, color]) => {
              const n = splitNotes(notes);
              if (!n.length) return null;
              return (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, color }} aria-hidden="true">{icon}</span>
                    <span style={{ ...S.lbl, marginBottom: 0, textTransform: "uppercase" }}>{label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 1 }}>
                    {n.map((x, i) => <span key={i} style={{
                      fontSize: 14, color: "#1A1A18", padding: "5px 12px",
                      background: "#F1EFE8", borderRadius: 20,
                    }}>{x}</span>)}
                  </div>
                </div>
              );
            })}
            {/* Tags */}
            {localNotes.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTop: "1px solid #F1EFE8" }} role="list" aria-label="Notiz-Tags">
                {localNotes.map(t => (
                  <span key={t} role="listitem" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 20, background: "#F1EFE8", fontSize: 10 }}>
                    <button onClick={() => onSearchNote && onSearchNote(t)} aria-label={`Nach "${t}" suchen`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 10 }}>{t}</button>
                    <button onClick={() => removeTag(t)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 9, color: "#B4B2A9" }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
            <button onClick={() => openOverlay(setShowJournal)}
              style={{
                background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#888780",
                fontFamily: "'Georgia',serif", transition: "color .15s"
              }}
              onMouseEnter={function (e) { e.currentTarget.style.color = "#534AB7" }}
              onMouseLeave={function (e) { e.currentTarget.style.color = "#888780" }}>
              ✎ Notizbuch
            </button>
            <span style={{ color: "#D3D1C7", margin: "0 8px" }}>·</span>
            <button onClick={() => setShowConfirmDelete(true)}
              style={{
                background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#C8C6BE",
                fontFamily: "'Georgia',serif", transition: "color .15s"
              }}
              onMouseEnter={function (e) { e.currentTarget.style.color = "#E24B4A" }}
              onMouseLeave={function (e) { e.currentTarget.style.color = "#C8C6BE" }}>
              Löschen
            </button>
          </div>

          {showJournal && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9000,
              display: "flex", alignItems: "flex-start", justifyContent: "center",
              paddingTop: "max(env(safe-area-inset-top),20px)", padding: "max(env(safe-area-inset-top),20px) 16px 16px", overflowY: "auto", overscrollBehavior: "contain"
            }}
              onClick={() => { setJournalText(local.journal || ""); setShowJournal(false) }}>
              <div style={{
                background: "#fff", borderRadius: 12, padding: 20,
                maxWidth: 420, width: "100%", maxHeight: "80dvh", overflowY: "auto", WebkitOverflowScrolling: "touch",
                boxShadow: "0 8px 32px rgba(0,0,0,.2)"
              }}
                onClick={function (e) { e.stopPropagation() }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ ...S.lbl, marginBottom: 0 }}>NOTIZBUCH</div>
                  <button onClick={() => { setJournalText(local.journal || ""); setShowJournal(false) }} aria-label="Schließen"
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#B4B2A9", padding: 4 }}>✕</button>
                </div>
                <textarea value={journalText} onChange={e => setJournalText(e.target.value)}
                  placeholder="Deine Gedanken, Eindrücke, Erinnerungen..."
                  style={{ ...S.ta, minHeight: 200, fontSize: 14, lineHeight: 1.7, padding: "12px" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                  <span style={{ fontSize: 10, color: "#888780" }}>{journalText.length} Zeichen</span>
                  <button onClick={() => { onUpdate(perfume.id, { journal: journalText }); setShowJournal(false) }}
                    style={{ ...S.btn("pri"), padding: "10px 20px" }}>Speichern</button>
                </div>
              </div>
            </div>
          )}

          {showNotes && <NotesEditModal perfume={local} onClose={() => setShowNotes(false)}
            onUpdate={onUpdate} onSaveNote={onSaveNote} localNotes={localNotes}
            onSearchNote={onSearchNote} removeTag={removeTag} addTag={addTag}
            noteInput={noteInput} setNoteInput={setNoteInput} />}

          {/* ── Reload Diff Modal ─────────────────────────────────────────── */}
          {reloadState === "diff" && reloadDiff && (
            <ReloadDiffModal
              reloadDiff={reloadDiff}
              onApply={fields => applyReload(fields)}
              onClose={() => { setReloadState("idle"); setReloadDiff(null); }}
            />
          )}

          {showConfirmDelete && (
            <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-del-title"
              style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9100,
                display: "flex", alignItems: "center", justifyContent: "center", padding: 20
              }}>
              <div style={{
                background: "#fff", borderRadius: 12, padding: 20, maxWidth: 340, width: "100%",
                boxShadow: "0 8px 32px rgba(0,0,0,.2)"
              }}>
                <div id="confirm-del-title" style={{ fontSize: 14, fontWeight: 500, color: "#1A1A18", marginBottom: 8 }}>
                  „{local.name}" wirklich löschen?
                </div>
                <div style={{ fontSize: 12, color: "#888780", marginBottom: 16 }}>
                  Dieser Vorgang kann nicht rückgängig gemacht werden.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { onDelete(local.id); onClose(); }}
                    style={{ ...S.btn("pri"), background: "#E24B4A", flex: 1 }}>Ja, löschen</button>
                  <button onClick={() => setShowConfirmDelete(false)}
                    style={{ ...S.btn("out"), flex: 1 }}>Abbrechen</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── Reusable Parfum Components ─────────────────────────────────────────────────

    // Zentrale ParfumLink Komponente für konsistente Navigation
    function ParfumLink({ p, onClick, style, showRating = true, showHouse = true }) {
      const handleClick = () => onClick && onClick(p.id);
      return (
        <button type="button" onClick={handleClick}
          style={{
            background: "none", border: "none", padding: 0, cursor: "pointer",
            fontSize: 13, fontFamily: "'Georgia',serif", color: "inherit", textAlign: "left", ...style
          }}>
          {p.name}
          {showRating && p.rating > 0 && <span style={{ fontSize: 10, color: "#BA7517", marginLeft: 6 }}>{"★".repeat(Math.min(5, Math.max(0, Math.round(p.rating || 0))))}</span>}
          {showHouse && <span style={{ fontSize: 11, color: "#888780", marginLeft: 6 }}>{p.house}</span>}
        </button>
      );
    }

    // Memoized perfume list item for statistics
    const StatistikPerfumeItem = React.memo(function StatistikPerfumeItem({ p, onSelectPerfume, fc }) {
      const noteCount = (p.top ? p.top.split(",").length : 0) + (p.middle ? p.middle.split(",").length : 0) + (p.base ? p.base.split(",").length : 0);
      return (
        <div style={{
          padding: "7px 0", borderBottom: "1px solid #F1EFE8", fontSize: 13,
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <ParfumLink p={p} onClick={onSelectPerfume} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {noteCount > 0 && <span style={{ fontSize: 9, color: "#B4B2A9" }}>{noteCount} Noten</span>}
            {p.rating > 0 && <span style={{ fontSize: 10, color: "#BA7517" }}>{"★".repeat(Math.min(5, Math.max(0, Math.round(p.rating || 0))))}</span>}
          </div>
        </div>
      );
    });

    // Memoized card for Sammlung
    const PerfumeCard = React.memo(function PerfumeCard({ p, notes, onClick, noteFieldLabel, fillLevel }) {
      const noteCount = (notes[p.id] || []).length;
      const noteHits = (p._hits || []).filter(h => ["top", "middle", "base"].includes(h.field));
      const families = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];

      return (
        <div onClick={onClick}
          role="button" tabIndex={0}
          aria-label={`${p.name} – ${p.house}, ${p.conc || "?"}, ${p.family || "Sonstiges"}${p.rating > 0 ? ", " + p.rating + " Sterne" : ""}`}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
          style={{
            ...S.card, cursor: "pointer", padding: "11px 14px", marginBottom: 8,
            transition: "all .4s cubic-bezier(0.25,.46,.45,.94)", transform: "translateY(0)",
            boxShadow: "0 1px 3px rgba(26,26,24,0.04)"
          }}
          onMouseEnter={function (e) { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 8px 25px rgba(26,26,24,0.1)" }}
          onMouseLeave={function (e) { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(26,26,24,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <div style={{ fontSize: 11, color: "#888780", marginTop: 1 }}>{p.house} · {p.conc}</div>
            </div>
            <div style={{ marginLeft: 10, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              {families.map((f, idx) => (
                <span key={f} style={idx === 0 ? S.pill(FAM_COLORS[f] || "#888") : { fontSize: 9, padding: "2px 8px", borderRadius: 12, border: `1px solid ${FAM_COLORS[f] || "#888"}`, background: "transparent", color: FAM_COLORS[f] || "#888", fontWeight: 400 }}>{f}</span>
              ))}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {p.rating > 0 && <span style={{ fontSize: 10, color: "#BA7517" }}>{"★".repeat(Math.min(5, Math.max(0, Math.round(p.rating || 0))))}</span>}
                {noteCount > 0 && <span style={{ fontSize: 10, color: "#B4B2A9" }}>✎{noteCount}</span>}
              </div>
            </div>
          </div>
          {noteHits.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7, paddingTop: 7, borderTop: "1px solid #F1EFE8" }}>
              {noteHits.map((h, i) => (
                <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "#EEEDFE", color: "#3C3489", display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span style={{ opacity: 0.5 }}>{noteFieldLabel[h.field]}</span>{h.value}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    });

    function SammlungTab({ items, log, notes, onDelete, onUpdate, onExport, onSaveNote, onLog, fillLevels, onSetFill, priceMl, onSavePriceMl }) {
      const [rawSearch, setRawSearch] = useState("");
      const { debounced: debouncedRawSearch, signal: searchSignal, abort: abortSearch } = useDebounce(rawSearch, 300);
      const [activeTerms, setActiveTerms] = useState([]); // committed search terms
      const [fam, setFam] = useState("Alle");
      const [seas, setSeas] = useState("Alle");
      const [fmt, setFmt] = useState("Alle");
      const [sort, setSort] = useState("name");
      const [detail, setDetail] = useState(null);
      const [showNotesPicker, setShowNotesPicker] = useState(false);
      const [displayCount, setDisplayCount] = useState(15);
      const [filteredItems, setFilteredItems] = useState([]);
      const inputRef = useRef(null);
      const sammlungDetailRef = useRef(null);

      

      useEffect(() => {
        if (detail && !items.find(x => x.id === detail)) setDetail(null);
      }, [detail, items]);

      // Commit rawSearch into activeTerms on Enter or comma
      function commitSearch() {
        const parts = rawSearch.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
        if (!parts.length) return;
        const newTerms = [...new Set([...activeTerms, ...parts])];
        setActiveTerms(newTerms);
        setRawSearch("");
      }
      function removeTerm(t) { setActiveTerms(prev => prev.filter(x => x !== t)); }
      function addNoteTerm(note) {
        if (!activeTerms.includes(note)) setActiveTerms(prev => [...prev, note]);
        setShowNotesPicker(false);
      }
      function clearAll() { setActiveTerms([]); setRawSearch(""); }

      // All unique notes sorted by frequency – for the picker
      const allNotes = useMemo(() => getAllNotes(items), [items]);
      const families = useMemo(() => ["Alle", ...new Set(items.map(i => i.family).filter(Boolean))].sort(), [items]);

            // Combined terms = committed + current rawSearch (live preview)
      const liveTerms = useMemo(() => {
        const extra = debouncedRawSearch.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
        return [...new Set([...activeTerms, ...extra])].map(normalizeTerm);
      }, [activeTerms, debouncedRawSearch]);

// Helper: run the actual filtering logic (shared between effects)
      const runFilters = useCallback(() => {
        const wc = {}; log.forEach(l => { wc[l.id] = (wc[l.id] || 0) + 1; });
        let r = items
          .map(p => {
            const { matched, hits } = matchPerfume(p, liveTerms);
            return matched ? { ...p, _hits: hits } : null;
          })
          .filter(p => p !== null)
          .filter(p =>
            (fam === "Alle" || p.family === fam) &&
            (seas === "Alle" || (p.season || "").includes(seas)) &&
            (fmt === "Alle" || p.format === fmt)
          );
        if (sort === "name") r = [...r].sort((a, b) => a.name.localeCompare(b.name));
        if (sort === "house") r = [...r].sort((a, b) => a.house.localeCompare(b.house));
        if (sort === "rating") r = [...r].sort((a, b) => (b.rating || 0) - (a.rating || 0));
        if (sort === "family") r = [...r].sort((a, b) => a.family.localeCompare(b.family));
        if (sort === "worn") r = [...r].sort((a, b) => (wc[b.id] || 0) - (wc[a.id] || 0));
        return r;
      }, [items, liveTerms, log, fam, seas, fmt, sort]);
      // Asynchronous search with AbortController to cancel obsolete requests
      // and prevent race conditions when new input arrives.
      useEffect(() => {
        // If the search has been aborted (new input arrived), skip
        if (searchSignal?.aborted) return;

        // Schedule the search asynchronously
        const timeoutId = setTimeout(() => {
          // Double-check that the search hasn't been aborted
          if (searchSignal?.aborted) return;

          // Run the actual filtering using shared helper
          const result = runFilters();
          // Only apply results if the search hasn't been cancelled
          if (!searchSignal?.aborted) {
            setFilteredItems(result);
          }
        }, 0);

        // Cleanup: abort this search when a new one starts or on unmount
        return () => {
          clearTimeout(timeoutId);
          abortSearch();
        };
      }, [debouncedRawSearch, searchSignal, runFilters]);

      // Also run filtering when non-search filters change (sync is fine here)
      useEffect(() => {
        setFilteredItems(runFilters());
      }, [runFilters]);
      // Reset displayCount when filters change
      useEffect(() => { setDisplayCount(15); }, [liveTerms, fam, seas, fmt, sort]);
      const visible = useMemo(() => filteredItems.slice(0, displayCount), [filteredItems, displayCount]);

      // Note hits to display per perfume card
      const noteFieldLabel = { top: "↑", middle: "○", base: "↓" };

      if (detail) {
        const p = items.find(x => x.id === detail);
        if (!p) return null;
        return (
          <DetailView perfume={p} items={items} log={log} notes={notes}
            onClose={() => setDetail(null)} onDelete={onDelete}
            onUpdate={onUpdate} onSaveNote={onSaveNote} onLog={onLog}
            onSearchNote={note => { addNoteTerm(note); setDetail(null); }}
            fillLevels={fillLevels || {}} onSetFill={onSetFill || ((id, l) => { })}
            priceMl={priceMl || {}} onSavePriceMl={onSavePriceMl || ((id, d) => { })} />
        );
      }

      return (
        <div>
          {/* Search input */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input id="sammlung-search" ref={inputRef} value={rawSearch}
              onChange={e => setRawSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitSearch(); }
                if (e.key === "Backspace" && !rawSearch && activeTerms.length) {
                  setActiveTerms(prev => prev.slice(0, -1));
                }
              }}
              placeholder={activeTerms.length ? "Weiteren Begriff…" : "Name, Haus, Note… Enter zum Hinzufügen"}
              style={{ ...S.inp, paddingRight: 80 }} />
            <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 4 }}>
              <button onClick={() => setShowNotesPicker(v => !v)}
                aria-label="Note aus Sammlung wählen"
                title="Note aus Sammlung wählen"
                style={{
                  background: "none", border: "0.5px solid #D3D1C7", borderRadius: 6, cursor: "pointer",
                  fontSize: 11, padding: "3px 7px", color: "#888780"
                }}>
                ♩
              </button>
              {(activeTerms.length > 0 || rawSearch) && (
                <button onClick={clearAll} aria-label="Suche leeren"
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9", padding: "0 2px" }}>
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Active term chips */}
          {activeTerms.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {activeTerms.map(t => (
                <span key={t} style={{
                  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
                  padding: "3px 8px 3px 10px", borderRadius: 20, background: "#1A1A18", color: "#fff"
                }}>
                  {t}
                  <button onClick={() => removeTerm(t)} aria-label={`Suchbegriff "${t}" entfernen`}
                    style={{
                      background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)",
                      fontSize: 12, padding: 0, lineHeight: 1, marginLeft: 2
                    }}>✕</button>
                </span>
              ))}
              <span style={{ fontSize: 10, color: "#888780", alignSelf: "center" }}>
                {activeTerms.length > 1 ? "(alle müssen passen)" : ""}
              </span>
            </div>
          )}

          {/* Notes picker dropdown */}
          {showNotesPicker && (
            <div style={{ ...S.card, marginBottom: 8, padding: "12px", maxHeight: 200, overflowY: "auto" }}>
              <div style={S.lbl}>NOTE WÄHLEN</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {allNotes.slice(0, 60).map(n => {
                  const active = activeTerms.includes(n) || activeTerms.includes(normalizeTerm(n));
                  return (
                    <button key={n} onClick={() => addNoteTerm(n)}
                      style={{ ...S.chip(active, "#534AB7"), padding: "3px 9px", fontSize: 11 }}>
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <select id="filter-familie" value={fam} onChange={e => setFam(e.target.value)}
              style={{ ...S.inp, width: "auto", fontSize: 12, padding: "6px 8px", flex: 1 }}>
              {families.map(f => <option key={f}>{f}</option>)}
            </select>
            <select id="filter-saison" value={seas} onChange={e => setSeas(e.target.value)}
              style={{ ...S.inp, width: "auto", fontSize: 12, padding: "6px 8px", flex: 1 }}>
              {["Alle", "Frühling", "Sommer", "Herbst", "Winter", "Ganzjährig"].map(s => <option key={s}>{s}</option>)}
            </select>
            <select id="filter-format" value={fmt} onChange={e => setFmt(e.target.value)}
              style={{ ...S.inp, width: "auto", fontSize: 12, padding: "6px 8px" }}>
              {["Alle", "Probe", "Flakon", "Decant"].map(f => <option key={f}>{f}</option>)}
            </select>
          </div>

          {/* Sort */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#888780" }}>SORT:</span>
            {[["name", "A–Z"], ["house", "Haus"], ["rating", "★"], ["family", "Familie"], ["worn", "Getragen"]].map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)}
                style={{ ...S.chip(sort === k), padding: "4px 10px", fontSize: 10 }}>{l}</button>
            ))}
            <button onClick={onExport}
              style={{ ...S.btn("out"), marginLeft: "auto", fontSize: 11, padding: "5px 10px", whiteSpace: "nowrap" }}>
              TSV ↓
            </button>
          </div>

          <div style={{ fontSize: 11, color: "#888780", marginBottom: 10 }}>
            {filteredItems.length} / {items.length}
            {filteredItems.length > displayCount ? ` · zeige ${displayCount}` : ""}
          </div>

          {/* Results */}
          {items.length === 0 ? (
            <div style={{ padding: 20 }}>
              <div style={{ ...S.skeleton("60%", 18), marginBottom: 16 }} />
              <div style={{ ...S.skeleton("40%", 12), marginBottom: 8 }} />
              <div style={{ ...S.skeleton("80%", 12), marginBottom: 8 }} />
              <div style={{ ...S.skeleton("70%", 12), marginBottom: 8 }} />
              <div style={{ ...S.skeleton("50%", 12), marginBottom: 24 }} />
              <div style={{ ...S.skeleton("100%", 40), borderRadius: 12 }} />
              <div style={{ ...S.skeleton("100%", 40), borderRadius: 12, marginTop: 8 }} />
              <div style={{ ...S.skeleton("100%", 40), borderRadius: 12, marginTop: 8 }} />
            </div>
          ) : visible.map(p => {
            return (
              <PerfumeCard key={p.id} p={p} notes={notes} onClick={() => setDetail(p.id)} noteFieldLabel={noteFieldLabel} fillLevel={fillLevels?.[p.id] ?? null} />
            );
          })}
          {filteredItems.length > displayCount && (
            <button onClick={() => setDisplayCount(c => c + 15)}
              style={{ ...S.btn("out"), width: "100%", fontSize: 12, padding: "12px", marginBottom: 8 }}>
              Mehr anzeigen ({filteredItems.length - displayCount} weitere)
            </button>
          )}
          {filteredItems.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}>🔍</div>
              <div style={{ fontSize: 14, color: "#888780", marginBottom: 16 }}>
                {liveTerms.length > 0
                  ? `Keine Treffer für "${liveTerms.join(', ')}"`
                  : "Keine Parfüms gefunden"}
              </div>
              {liveTerms.length > 0 && (
                <button onClick={() => { setLiveTerms([]); setFamilyFilter("Alle"); setSeasonFilter("Alle"); setFormatFilter("Alle"); }}
                  style={{ ...S.btn("out"), fontSize: 12, padding: "8px 16px" }}>
                  Filter zurücksetzen
                </button>
              )}
            </div>
          )}
        </div>
      );
    }

    // ── Statistik tab (expanded) ──────────────────────────────────────────────────
    function StatistikTab({ items, log, onSelectPerfume }) {
      const [drill, setDrill] = useState(null);
      const [statsTab, setStatsTab] = useState("profil");
      const total = items.length || 1;

      const famC = useMemo(() => {
        const c = {};
        items.forEach(p => {
          // Count all families (weighted: primary = 1.0, secondary = 0.5)
          const fams = (p.families && p.families.length > 0) ? p.families : [p.family || "Sonstiges"];
          fams.forEach((f, idx) => {
            const w = idx === 0 ? 1.0 : idx === 1 ? 0.5 : 0.25; // Prioritäts-Gewichtung (#8)
            c[f] = (c[f] || 0) + w;
          });
        });
        return Object.entries(c)
          .filter(([, v]) => v >= 0.25) // mindestens 1× als dritte Familie
          .sort((a, b) => b[1] - a[1])
          .map(([fam, count]) => [fam, Math.round(count)]); // auf ganze Zahl runden für Anzeige
      }, [items]);

      const noteC = useMemo(() => {
        const c = {};
        items.forEach(p => [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
          .forEach(n => { c[n] = (c[n] || 0) + 1; }));
        return Object.entries(c).sort((a, b) => b[1] - a[1]);
      }, [items]);

      const wearByPerfume = useMemo(() => {
        const c = {}; log.forEach(l => { c[l.id] = (c[l.id] || 0) + 1; });
        return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([id, n]) => ({ p: items.find(x => x.id === id), n })).filter(x => x.p);
      }, [log, items]);

      const avgRatingByFam = useMemo(() => {
        const sums = {}; const cnts = {};
        items.filter(p => p.rating > 0).forEach(p => {
          const f = p.family || "Sonstiges";
          sums[f] = (sums[f] || 0) + p.rating; cnts[f] = (cnts[f] || 0) + 1;
        });
        return Object.entries(sums).map(([f, s]) => ([f, (s / cnts[f]).toFixed(1), cnts[f]]))
          .sort((a, b) => b[1] - a[1]);
      }, [items]);

      const monthlyWear = useMemo(() => {
        const c = {};
        log.forEach(l => {
          const k = new Date(l.ts).toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
          c[k] = (c[k] || 0) + 1;
        });
        const entries = Object.entries(c);
        return entries.slice(-12);
      }, [log]);

      const wearByFam = useMemo(() => {
        const c = {};
        log.forEach(l => {
          const p = items.find(x => x.id === l.id);
          if (p) { const f = p.family || "Sonstiges"; c[f] = (c[f] || 0) + 1; }
        });
        return Object.entries(c).sort((a, b) => b[1] - a[1]);
      }, [log, items]);

      const concC = useMemo(() => {
        const c = {}; items.forEach(p => { c[p.conc || "?"] = (c[p.conc || "?"] || 0) + 1; });
        return Object.entries(c).sort((a, b) => b[1] - a[1]);
      }, [items]);

      const seasC = useMemo(() => {
        const c = { Frühling: 0, Sommer: 0, Herbst: 0, Winter: 0, Ganzjährig: 0 };
        items.forEach(p => Object.keys(c).forEach(k => { if ((p.season || "").includes(k)) c[k]++; }));
        return Object.entries(c).sort((a, b) => b[1] - a[1]);
      }, [items]);

      // EDGE CASE: Math.max(...spread) → Stack Overflow bei 400+ Einträgen → reduce
      const maxWear = wearByPerfume.reduce((m, x) => Math.max(m, x.n), 1);
      const maxMonth = monthlyWear.reduce((m, e) => Math.max(m, e[1]), 1);
      const maxFamWear = wearByFam.reduce((m, e) => Math.max(m, e[1]), 1);

      const STABS = [
        { id: "profil", label: "Profil" },
        { id: "nutzung", label: "Nutzung" },
        { id: "noten", label: "Noten" },
        { id: "favoriten", label: "Favoriten" },
      ];

      if (drill) {
        const fi = items.filter(p => p.family === drill);
        const fc = FAM_COLORS[drill] || "#888";
        const notes = {};
        fi.forEach(p => [...splitNotes(p.top), ...splitNotes(p.middle), ...splitNotes(p.base)]
          .forEach(n => { notes[n] = (notes[n] || 0) + 1; }));
        const famWears = log.filter(l => fi.some(p => p.id === l.id)).length;
        return (
          <div>
            <button onClick={() => setDrill(null)} style={{ ...S.btn(), marginBottom: 16 }}>← Zurück</button>
            <div style={S.card}>
              <div style={{ fontSize: 18, color: fc, marginBottom: 4 }}>{drill}</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                <div><div style={{ fontSize: 22, fontWeight: 400 }}>{fi.length}</div><div style={{ fontSize: 10, color: "#888780" }}>PARFÜMS</div></div>
                <div><div style={{ fontSize: 22, fontWeight: 400 }}>{Math.round(fi.length / total * 100)}%</div><div style={{ fontSize: 10, color: "#888780" }}>DER SAMMLUNG</div></div>
                <div><div style={{ fontSize: 22, fontWeight: 400 }}>{famWears}</div><div style={{ fontSize: 10, color: "#888780" }}>MAL GETRAGEN</div></div>
                {fi.filter(p => p.rating > 0).length > 0 && (
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 400 }}>
                      {(fi.filter(p => p.rating > 0).reduce((s, p) => s + p.rating, 0) / (fi.filter(p => p.rating > 0).length || 1)).toFixed(1)}
                    </div>
                    <div style={{ fontSize: 10, color: "#888780" }}>Ø BEWERTUNG</div>
                  </div>
                )}
              </div>
              <div style={S.lbl}>HÄUFIGSTE NOTEN</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
                {Object.entries(notes).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => (
                  <span key={n} style={{ ...S.pill(fc), fontSize: 11, padding: "4px 10px" }}>{n} ×{c}</span>
                ))}
              </div>
              <div style={S.lbl}>PARFÜMS</div>
              {[...fi].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                <StatistikPerfumeItem key={p.id} p={p} onSelectPerfume={onSelectPerfume} fc={fc} />
              ))}
            </div>
          </div>
        );
      }

      return (
        <div>
          {/* Summary row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
            {[["Gesamt", items.length], ["Flakons", items.filter(p => p.format === "Flakon").length],
            ["Bewertet", items.filter(p => p.rating > 0).length], ["Getragen", log.length]].map(([l, v]) => (
              <div key={l} style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 10, padding: "10px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 400 }}>{v}</div>
                <div style={{ fontSize: 9, color: "#888780", letterSpacing: "0.5px" }}>{l.toUpperCase()}</div>
              </div>
            ))}
          </div>

          {/* Sub-tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #E8E6E0", marginBottom: 16 }}>
            {STABS.map(t => (
              <button key={t.id} onClick={() => setStatsTab(t.id)}
                style={{ ...S.dtab(statsTab === t.id), fontSize: 11 }}>{t.label}</button>
            ))}
          </div>

          {statsTab === "profil" && (
            <div>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={S.lbl}>DUFTPROFIL · tippen für Details</div>
                {famC.filter(([, count]) => count >= 1).map(([fam, count]) => {
                  const pct = Math.round(count / total * 100), fc = FAM_COLORS[fam] || "#888";
                  return (
                    <div key={fam} onClick={() => setDrill(fam)} style={{ marginBottom: 10, cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 13 }}>{fam}</span>
                        <span style={{ fontSize: 11, color: "#888780" }}>{pct}% · {count}×</span>
                      </div>
                      <MiniBar pct={pct} color={fc} />
                    </div>
                  );
                })}
              </div>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={S.lbl}>SAISON-VERTEILUNG</div>
                {seasC.map(([s, n]) => {
                  const sc = getSeasonColor(s);
                  return (
                    <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                      <div style={{ width: 64, fontSize: 12 }}>{s}</div>
                      <MiniBar pct={Math.round(n / total * 100)} color={sc.accent} />
                      <div style={{ fontSize: 11, color: "#888780", minWidth: 20, textAlign: "right" }}>{n}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={S.lbl}>KONZENTRATION</div>
                {concC.map(([c, n]) => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                    <div style={{ width: 52, fontSize: 12, fontWeight: 500 }}>{c}</div>
                    <MiniBar pct={Math.round(n / total * 100)} color="#534AB7" />
                    <div style={{ fontSize: 11, color: "#888780", minWidth: 20, textAlign: "right" }}>{n}</div>
                  </div>
                ))}
              </div>
              <DuftDNASection items={items} log={log} />
            </div>
          )}

          {statsTab === "nutzung" && (
            <div>
              {log.length === 0 ? (
                <div style={{ textAlign: "center", color: "#888780", padding: "40px 0", fontSize: 13 }}>
                  Noch kein Trage-Verlauf. Nutze „Tragen" in der Heute-Ansicht.
                </div>
              ) : (
                <div>
                  <div style={{ ...S.card, marginBottom: 12 }}>
                    <div style={S.lbl}>TOP 10 MEISTGETRAGEN</div>
                    {wearByPerfume.map(({ p, n }, i) => (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ fontSize: 10, color: "#B4B2A9", minWidth: 16 }}>#{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontFamily: "inherit", color: "inherit", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", width: "100%" }}>{p.name}</button>
                          <div style={{ fontSize: 10, color: "#888780" }}>{p.house}</div>
                        </div>
                        <MiniBar pct={n / maxWear * 100} color={FAM_COLORS[p.family] || "#888"} height={4} />
                        <div style={{ fontSize: 11, color: "#888780", minWidth: 24, textAlign: "right" }}>×{n}</div>
                      </div>
                    ))}
                  </div>
                  {monthlyWear.length > 1 && (
                    <div style={{ ...S.card, marginBottom: 12 }}>
                      <div style={S.lbl}>TRAGEHÄUFIGKEIT (MONATE)</div>
                      {monthlyWear.map(([k, n]) => (
                        <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                          <div style={{ width: 56, fontSize: 11, color: "#888780" }}>{k}</div>
                          <MiniBar pct={n / maxMonth * 100} color="#1D9E75" />
                          <div style={{ fontSize: 11, color: "#888780", minWidth: 20, textAlign: "right" }}>{n}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={S.card}>
                    <div style={S.lbl}>GETRAGEN NACH DUFTFAMILIE</div>
                    {wearByFam.map(([f, n]) => {
                      const fc = FAM_COLORS[f] || "#888";
                      return (
                        <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                          <div style={{ width: 72, fontSize: 12 }}>{f}</div>
                          <MiniBar pct={n / maxFamWear * 100} color={fc} />
                          <div style={{ fontSize: 11, color: "#888780", minWidth: 24, textAlign: "right" }}>×{n}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {statsTab === "noten" && (
            <div>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={S.lbl}>TOP 30 DUFTNOTEN</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {noteC.slice(0, 30).map(([n, c], i) => {
                    const size = i < 5 ? 13 : i < 12 ? 11 : 10;
                    const opacity = Math.max(0.5, 1 - i * 0.025);
                    return (
                      <span key={n} style={{ ...S.pill("#5F5E5A"), fontSize: size, opacity, padding: "3px 9px" }}>
                        {n} <span style={{ opacity: .7 }}>×{c}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
              <div style={S.card}>
                <div style={S.lbl}>NOTEN NACH KATEGORIE</div>
                {[["Kopfnoten", items.map(p => splitNotes(p.top)).flat()],
                ["Herznoten", items.map(p => splitNotes(p.middle)).flat()],
                ["Basisnoten", items.map(p => splitNotes(p.base)).flat()]].map(([cat, allNotes]) => {
                  const c = {}; allNotes.forEach(n => { c[n] = (c[n] || 0) + 1; });
                  const top5 = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5);
                  return (
                    <div key={cat} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "#1A1A18" }}>{cat}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {top5.map(([n, cnt]) => (
                          <span key={n} style={{ ...S.pill("#5F5E5A"), fontSize: 10, padding: "2px 8px" }}>{n} ×{cnt}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {statsTab === "favoriten" && (
            <div>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={S.lbl}>5-STERNE PARFÜMS</div>
                {items.filter(p => p.rating === 5).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                  <div key={p.id} style={{ padding: "7px 0", borderBottom: "1px solid #F1EFE8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: "inherit", textAlign: "left" }}>{p.name}</button>
                      <div style={{ fontSize: 10, color: "#888780" }}>{p.house}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(p.families && p.families.length > 0 ? p.families : [p.family || "Sonstiges"]).map((f, idx) => (
                        <span key={f} style={idx === 0 ? S.pill(FAM_COLORS[f] || "#888") : { fontSize: 9, padding: "2px 8px", borderRadius: 12, border: `1px solid ${FAM_COLORS[f] || "#888"}`, background: "transparent", color: FAM_COLORS[f] || "#888", fontWeight: 400 }}>{f}</span>
                      ))}
                    </div>
                  </div>
                ))}
                {items.filter(p => p.rating === 5).length === 0 && (
                  <div style={{ fontSize: 12, color: "#888780" }}>Noch keine 5-Sterne-Bewertungen.</div>
                )}
              </div>
              {avgRatingByFam.length > 0 && (
                <div style={{ ...S.card, marginBottom: 12 }}>
                  <div style={S.lbl}>Ø BEWERTUNG PRO FAMILIE</div>
                  {avgRatingByFam.map(([f, avg, cnt]) => {
                    const fc = FAM_COLORS[f] || "#888";
                    return (
                      <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ width: 72, fontSize: 12 }}>{f}</div>
                        <MiniBar pct={parseFloat(avg) / 5 * 100} color={fc} />
                        <div style={{ fontSize: 11, color: "#888780", minWidth: 40, textAlign: "right" }}>{avg} ★</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={S.card}>
                <div style={S.lbl}>ALLE BEWERTETEN PARFÜMS</div>
                {items.filter(p => p.rating > 0).sort((a, b) => (b.rating || 0) - (a.rating || 0)).map(p => (
                  <div key={p.id} style={{ padding: "7px 0", borderBottom: "1px solid #F1EFE8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: "inherit", textAlign: "left" }}>{p.name}</button>
                      <div style={{ fontSize: 10, color: "#888780" }}>{p.house}</div>
                    </div>
                    <Stars rating={p.rating} size={13} />
                  </div>
                ))}
                {items.filter(p => p.rating > 0).length === 0 && (
                  <div style={{ fontSize: 12, color: "#888780" }}>Bewerte Parfüms in der Detailansicht.</div>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── Wunschliste detail portal (renders into document.body to escape tab stacking context) ──
    function WishDetailPortal({ selectedWish, wishDetails, loadingDetails, items, prioLabels, moveToCollection, setSelectedWish, setWishDetails }) {
      const alreadyOwned = items.some(p => p.url && selectedWish.url && p.url === selectedWish.url);
      const content = (
        <div onClick={() => { setSelectedWish(null); setWishDetails(null); }}
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overscrollBehavior: "contain" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, maxWidth: 400, width: "100%", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            {/* Header with gradient */}
            <div style={{ height: 100, background: "linear-gradient(135deg, #1A1A18 0%, #534AB7 100%)", position: "relative" }}>
              <button onClick={() => { setSelectedWish(null); setWishDetails(null); }} style={{ position: "absolute", top: 12, right: 12, background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 20, padding: "8px 12px", cursor: "pointer", color: "#fff", fontSize: 14 }}>✕</button>
              <div style={{ position: "absolute", bottom: 16, left: 20 }}>
                <span style={{ fontSize: 10, letterSpacing: "1.5px", background: "rgba(255,255,255,0.2)", padding: "4px 12px", borderRadius: 20, color: "#fff" }}>{prioLabels[selectedWish.prio]}</span>
              </div>
            </div>
            {/* Content */}
            <div style={{ padding: 24, maxHeight: "70dvh", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
              {loadingDetails ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <div style={{ fontSize: 14, color: "#888780" }}>Lade Duftdetails…</div>
                </div>
              ) : wishDetails ? (
                <div>
                  <h3 style={{ fontSize: 22, fontFamily: "'Georgia',serif", fontWeight: 400, color: "#1A1A18", margin: "0 0 4px" }}>{wishDetails.name || selectedWish.name}</h3>
                  {(wishDetails.house || selectedWish.house) && <p style={{ fontSize: 14, color: "#888780", margin: "0 0 16px" }}>{wishDetails.house || selectedWish.house}</p>}
                  {(wishDetails.top || wishDetails.middle || wishDetails.base) && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9", marginBottom: 8 }}>DUFTNOTEN</div>
                      {wishDetails.top && <div style={{ marginBottom: 6 }}><span style={{ fontSize: 9, color: "#BA7517", fontWeight: 500, marginRight: 6 }}>KOPF</span><span style={{ fontSize: 12, color: "#1A1A18" }}>{wishDetails.top}</span></div>}
                      {wishDetails.middle && <div style={{ marginBottom: 6 }}><span style={{ fontSize: 9, color: "#534AB7", fontWeight: 500, marginRight: 6 }}>HERZ</span><span style={{ fontSize: 12, color: "#1A1A18" }}>{wishDetails.middle}</span></div>}
                      {wishDetails.base && <div><span style={{ fontSize: 9, color: "#1D9E75", fontWeight: 500, marginRight: 6 }}>BASIS</span><span style={{ fontSize: 12, color: "#1A1A18" }}>{wishDetails.base}</span></div>}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    {wishDetails.family && <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, textAlign: "center" }}><div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>FAMILIE</div><div style={{ fontSize: 11, color: "#1A1A18" }}>{wishDetails.family}</div></div>}
                    {wishDetails.season && <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, textAlign: "center" }}><div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>SAISON</div><div style={{ fontSize: 11, color: "#1A1A18" }}>{wishDetails.season}</div></div>}
                    {wishDetails.conc && <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, textAlign: "center" }}><div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>KONZ.</div><div style={{ fontSize: 11, color: "#1A1A18" }}>{wishDetails.conc}</div></div>}
                    {wishDetails.gender && <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, textAlign: "center" }}><div style={{ fontSize: 9, color: "#B4B2A9", marginBottom: 2 }}>GENDER</div><div style={{ fontSize: 11, color: "#1A1A18" }}>{wishDetails.gender}</div></div>}
                  </div>
                  {selectedWish.note && <div style={{ background: "#FAFAF8", borderRadius: 12, padding: 14, marginBottom: 16 }}><p style={{ fontSize: 12, fontStyle: "italic", color: "#888780", margin: 0, fontFamily: "'Georgia',serif", lineHeight: 1.5 }}>"{selectedWish.note}"</p></div>}
                  <div style={{ display: "flex", gap: 10 }}>
                    {!alreadyOwned && <button onClick={() => { moveToCollection({ ...selectedWish, ...wishDetails }); setSelectedWish(null); setWishDetails(null); }} style={{ flex: 1, ...S.btn("pri"), padding: "14px", borderRadius: 10, fontSize: 13 }}>→ Zur Sammlung</button>}
                    {selectedWish.url && <a href={selectedWish.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, ...S.btn("out"), padding: "14px", borderRadius: 10, fontSize: 13, textAlign: "center", textDecoration: "none", color: "#1A1A18" }}>Parfumo ↗</a>}
                  </div>
                </div>
              ) : (
                <div>
                  <h3 style={{ fontSize: 22, fontFamily: "'Georgia',serif", fontWeight: 400, color: "#1A1A18", margin: "0 0 8px" }}>{selectedWish.name}</h3>
                  {selectedWish.house && <p style={{ fontSize: 14, color: "#888780", margin: "0 0 20px" }}>{selectedWish.house}</p>}
                  {selectedWish.note && <div style={{ background: "#FAFAF8", borderRadius: 12, padding: 16, marginBottom: 16 }}><p style={{ fontSize: 13, fontStyle: "italic", color: "#888780", margin: 0, fontFamily: "'Georgia',serif", lineHeight: 1.6 }}>"{selectedWish.note}"</p></div>}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                    <div style={{ background: "#FAFAF8", borderRadius: 10, padding: 12, textAlign: "center" }}><div style={{ fontSize: 10, color: "#B4B2A9", marginBottom: 4 }}>HINZUGEFÜGT</div><div style={{ fontSize: 12, color: "#1A1A18" }}>{selectedWish.added ? new Date(selectedWish.added).toLocaleDateString("de-DE") : "Unbekannt"}</div></div>
                    <div style={{ background: "#FAFAF8", borderRadius: 10, padding: 12, textAlign: "center" }}><div style={{ fontSize: 10, color: "#B4B2A9", marginBottom: 4 }}>STATUS</div><div style={{ fontSize: 12, color: alreadyOwned ? "#1D9E75" : "#888780" }}>{alreadyOwned ? "In Sammlung" : "Noch nicht"}</div></div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {!alreadyOwned && <button onClick={() => { moveToCollection(selectedWish); setSelectedWish(null); }} style={{ flex: 1, ...S.btn("pri"), padding: "14px", borderRadius: 10, fontSize: 13 }}>→ Zur Sammlung</button>}
                    {selectedWish.url && <a href={selectedWish.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, ...S.btn("out"), padding: "14px", borderRadius: 10, fontSize: 13, textAlign: "center", textDecoration: "none", color: "#1A1A18" }}>Parfumo ↗</a>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
      return ReactDOM.createPortal(content, document.body);
    }

    // ── Wunschliste tab ───────────────────────────────────────────────────────────
    function WunschlisteTab({ wishlist, onSave, items, onAddToCollection, onSelectPerfume, wishDetailsCache, setWishDetailsCache }) {
      const [form, setForm] = useState({ name: "", house: "", url: "", prio: 2, note: "" });
      const [loading, setLoading] = useState(false);
      const [err, setErr] = useState("");
      const [linkUrl, setLinkUrl] = useState("");
      const [wishDisplayCount, setWishDisplayCount] = useState(15);
      const [showForm, setShowForm] = useState(false);
      const [selectedWish, setSelectedWish] = useState(null);
      useBodyLock(!!selectedWish);
      const [wishDetails, setWishDetails] = useState(null);
      const [loadingDetails, setLoadingDetails] = useState(false);
      const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

      async function fetchWishDetails(wish) {
        const cacheKey = wish.url || wish.name;
        console.log("fetchWishDetails called:", wish.name, "cacheKey:", cacheKey, "cached:", !!wishDetailsCache[cacheKey]);
        console.log("wishDetailsCache:", wishDetailsCache);

        if (cacheKey && wishDetailsCache[cacheKey]) {
          console.log("Using cached data");
          setWishDetails(wishDetailsCache[cacheKey]);
          return;
        }

        setLoadingDetails(true);
        setWishDetails(null);
        try {
          let data = null;
          if (wish.url) {
            const r = await lookupByUrl(wish.url);
            data = r;
          } else if (wish.name) {
            const searchUrl = `https://www.parfumo.de/search?search=${encodeURIComponent(wish.name)}`;
            const r = await lookupByUrl(searchUrl);
            data = r;
          }
          if (data) {
            setWishDetailsCache(prev => ({ ...prev, [cacheKey]: data }));
          }
          setWishDetails(data);
        } catch (e) {
          console.error("Fehler beim Laden der Details:", e);
        }
        setLoadingDetails(false);
      }

      function handleWishClick(w) {
        setSelectedWish(w);
        fetchWishDetails(w);
      }

      async function lookupWish() {
        if (!linkUrl.trim()) return;
        setLoading(true); setErr("");
        try {
          const raw = linkUrl.trim();
          const r = await lookupByUrl(raw);
          const safeUrl = validateParfumoLookupUrl(raw);
          setForm(f => ({ ...f, name: r.name, house: r.house, url: safeUrl }));
          setLinkUrl("");
          setShowForm(true);
        } catch (e) { setErr(e.message); }
        setLoading(false);
      }

      function addItem() {
        if (!form.name.trim()) return;
        const item = {
          id: newId(), name: form.name.trim(), house: form.house.trim(),
          url: form.url.trim(), prio: form.prio, note: form.note.trim(), added: new Date().toISOString()
        };
        onSave([...wishlist, item]);
        setForm({ name: "", house: "", url: "", prio: 2, note: "" });
        setShowForm(false);
      }

      function removeItem(id) { onSave(wishlist.filter(w => w.id !== id)); }

      function moveToCollection(w) {
        const newItem = {
          id: newId(), name: w.name, house: w.house, url: w.url,
          conc: "", family: "Sonstiges", top: "", middle: "", base: "", season: "Ganzjährig",
          gender: "Unisex", format: "Flakon", rating: 0
        };
        onAddToCollection(newItem);
        removeItem(w.id);
      }

      const sorted = [...wishlist].sort((a, b) => a.prio - b.prio);
      const prioColors = { 1: "#E24B4A", 2: "#BA7517", 3: "#B4B2A9" };
      const prioLabels = { 1: "Must Have", 2: "Sehnsucht", 3: "Irgendwann" };

      return (
        <div>
          {/* Header with elegant title */}
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 22, fontWeight: 400, fontFamily: "'Georgia',serif", color: "#1A1A18", margin: "0 0 4px", letterSpacing: "-0.5px" }}>Wunschliste</h2>
            <p style={{ fontSize: 12, color: "#888780", margin: 0 }}>Deine Duft-Träume</p>
          </div>

          {/* Quick-add bar - elegant design */}
          <div style={{ ...S.card, marginBottom: 16, padding: showForm ? "20px" : "14px 16px", borderRadius: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            {!showForm ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <label htmlFor="wish-quick-add" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Parfumo-Link oder Name</label>
                  <input id="wish-quick-add" value={linkUrl} onChange={e => { setLinkUrl(e.target.value); setErr(""); }}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); linkUrl.trim() && lookupWish(); } }}
                    placeholder="Parfumo-Link oder Name hinzufügen…"
                    style={{ ...S.inp, paddingRight: 10, borderColor: "#E8E6E0", background: "#FAFAF8", fontSize: 13, borderRadius: 10 }} />
                </div>
                {linkUrl.trim() ? (
                  <button onClick={linkUrl.includes("parfumo.de") ? lookupWish : () => { set("name", linkUrl); setLinkUrl(""); setShowForm(true); }}
                    disabled={loading}
                    style={{ ...S.btn("pri"), padding: "12px 18px", whiteSpace: "nowrap", fontSize: 12, borderRadius: 10 }}>
                    {loading ? "…" : linkUrl.includes("parfumo.de") ? "Laden" : "Weiter"}
                  </button>
                ) : (
                  <button onClick={() => setShowForm(true)}
                    style={{
                      background: "linear-gradient(135deg, #1A1A18 0%, #3a3a3a 100%)", border: "none", borderRadius: 10, cursor: "pointer",
                      padding: "12px", fontSize: 16, color: "#fff", lineHeight: 1, boxShadow: "0 2px 8px rgba(26,26,24,0.2)"
                    }}>+</button>
                )}
              </div>
            ) : (
              <div>
                {/* Expanded form */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 11, letterSpacing: "1.5px", color: "#888780" }}>NEUER WUNSCH</div>
                  <button onClick={() => { setShowForm(false); setForm({ name: "", house: "", url: "", prio: 2, note: "" }); setErr(""); }}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#B4B2A9", padding: 0 }}>✕</button>
                </div>

                {/* Link input */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input id="wish-link-input" value={linkUrl} onChange={e => { setLinkUrl(e.target.value); setErr(""); }}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); lookupWish(); } }}
                    placeholder="Parfumo-Link einfügen…"
                    style={{ ...S.inp, flex: 1, fontSize: 13, borderRadius: 10 }} />
                  <button onClick={lookupWish} disabled={loading || !linkUrl.trim()}
                    style={{
                      ...S.btn("out"), padding: "12px 16px", whiteSpace: "nowrap", fontSize: 12, borderRadius: 10,
                      opacity: loading || !linkUrl.trim() ? 0.5 : 1
                    }}>
                    {loading ? "…" : "Auto"}
                  </button>
                </div>

                {/* Name + House */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input id="wish-name" value={form.name} onChange={e => set("name", e.target.value)}
                    placeholder="Name *" style={{ ...S.inp, flex: 2, fontSize: 13, borderRadius: 10 }} />
                  <input id="wish-house" value={form.house} onChange={e => set("house", e.target.value)}
                    placeholder="Haus" style={{ ...S.inp, flex: 1, fontSize: 13, borderRadius: 10 }} />
                </div>

                {/* Priority */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {WISH_PRIOS.map(p => (
                    <button key={p.id} onClick={() => set("prio", p.id)}
                      style={{ ...S.chip(form.prio === p.id, p.color), fontSize: 11, padding: "8px 14px", flex: 1, borderRadius: 8 }}>
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Note */}
                <textarea id="wish-note" value={form.note} onChange={e => set("note", e.target.value)}
                  placeholder="Notiz (optional)…"
                  style={{ ...S.ta, minHeight: 50, fontSize: 13, marginBottom: 12, borderRadius: 10 }} />

                {err && <div style={{ fontSize: 12, color: "#E24B4A", marginBottom: 10 }}>{err}</div>}

                <button onClick={addItem} disabled={!form.name.trim()}
                  style={{
                    ...S.btn("pri"), width: "100%", fontSize: 13, padding: "14px", borderRadius: 10,
                    opacity: form.name.trim() ? 1 : .4, boxShadow: "0 2px 8px rgba(26,26,24,0.15)"
                  }}>
                  Zur Wunschliste
                </button>
              </div>
            )}
          </div>

          {/* Empty state - elegant */}
          {wishlist.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, #F5F4F1 0%, #E8E6E0 100%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <span style={{ fontSize: 28, color: "#B4B2A9" }}>✦</span>
              </div>
              <div style={{ fontSize: 14, color: "#888780", lineHeight: 1.6, fontFamily: "'Georgia',serif" }}>
                Noch keine Wünsche<br />
                <span style={{ fontSize: 12, color: "#B4B2A9" }}>Füge Parfüms per Link oder manuell hinzu</span>
              </div>
            </div>
          )}

          {/* Wish cards - elegant design */}
          {sorted.slice(0, wishDisplayCount).map(w => {
            const pc = WISH_PRIOS.find(p => p.id === w.prio);
            const alreadyOwned = items.some(p => p.url && p.url === w.url);
            const daysAgo = w.added ? Math.floor((Date.now() - new Date(w.added).getTime()) / (1000 * 60 * 60 * 24)) : null;
            return (
              <div key={w.id} onClick={() => handleWishClick(w)}
                style={{
                  ...S.card, padding: "18px 20px", marginBottom: 10,
                  borderRadius: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                  borderLeft: `4px solid ${prioColors[w.prio] || "#D3D1C7"}`,
                  cursor: "pointer", transition: "all .2s"
                }}
                onMouseEnter={function (e) { e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)" }}
                onMouseLeave={function (e) { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 500, fontFamily: "'Georgia',serif", color: "#1A1A18", marginBottom: 4 }}>{w.name}</div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {w.house && <span style={{ fontSize: 12, color: "#888780" }}>{w.house}</span>}
                      {daysAgo !== null && <span style={{ fontSize: 10, color: "#B4B2A9" }}>vor {daysAgo}d</span>}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, letterSpacing: "1px", padding: "4px 10px", borderRadius: 20,
                    background: prioColors[w.prio] + "15", color: prioColors[w.prio], fontWeight: 500
                  }}>
                    {prioLabels[w.prio]}
                  </span>
                </div>

                {w.note && <div style={{ fontSize: 12, color: "#888780", marginTop: 8, fontStyle: "italic", lineHeight: 1.5, fontFamily: "'Georgia',serif" }}>"{w.note}"</div>}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {!alreadyOwned && (
                    <button onClick={(e) => { e.stopPropagation(); moveToCollection(w); }}
                      style={{
                        fontSize: 11, padding: "8px 14px", borderRadius: 8,
                        border: "1px solid #E8E6E0", background: "#fff", cursor: "pointer",
                        color: "#534AB7", fontFamily: "'Georgia',serif", transition: "all .12s"
                      }}
                      onMouseEnter={function (e) { e.currentTarget.style.background = "#534AB7"; e.currentTarget.style.color = "#fff" }}
                      onMouseLeave={function (e) { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#534AB7" }}>
                      → Sammlung
                    </button>
                  )}
                  {w.url && (
                    <a href={w.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: 11, padding: "8px 14px", borderRadius: 8,
                        border: "1px solid #E8E6E0", background: "#fff",
                        color: "#888780", textDecoration: "none", transition: "all .12s"
                      }}
                      onMouseEnter={function (e) { e.currentTarget.style.borderColor = "#185FA5"; e.currentTarget.style.color = "#185FA5" }}
                      onMouseLeave={function (e) { e.currentTarget.style.borderColor = "#E8E6E0"; e.currentTarget.style.color = "#888780" }}>
                      Parfumo ↗
                    </a>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); removeItem(w.id); }} aria-label={`"${w.name}" von Wunschliste entfernen`}
                    style={{
                      background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#D3D1C7", padding: "8px", marginLeft: "auto",
                      transition: "color .12s"
                    }}
                    onMouseEnter={function (e) { e.currentTarget.style.color = "#E24B4A" }}
                    onMouseLeave={function (e) { e.currentTarget.style.color = "#D3D1C7" }}>✕</button>
                </div>
              </div>
            );
          })}

          {/* Wish detail overlay – Portal-Komponente rendert in document.body */}
          {selectedWish && (
            <WishDetailPortal
              selectedWish={selectedWish}
              wishDetails={wishDetails}
              loadingDetails={loadingDetails}
              items={items}
              prioLabels={prioLabels}
              moveToCollection={moveToCollection}
              setSelectedWish={setSelectedWish}
              setWishDetails={setWishDetails}
            />
          )}
        </div>
      );
    }

    // ── Einstellungen tab ─────────────────────────────────────────────────────────

    // ── Ordnerstruktur ────────────────────────────────────────────────────────────
    // Hierarchie: Ebene 1 = Saison → Ebene 2 = Familie → Ebene 3 = Haus → Parfüm
    const ORDNER_SCHEMES = [
      { id: "season_family", label: "Saison → Familie",   desc: "Hauptordner nach Jahreszeit, Unterordner nach Duftfamilie" },
      { id: "family_season", label: "Familie → Saison",   desc: "Hauptordner nach Duftfamilie, Unterordner nach Jahreszeit" },
      { id: "season_house",  label: "Saison → Haus",      desc: "Saisonal sortiert, darin alphabetisch nach Haus" },
      { id: "house_alpha",   label: "Haus A–Z",           desc: "Hauptordner nach Anfangsbuchstabe, Unterordner nach Haus" },
      { id: "format_season", label: "Format → Saison",    desc: "Alle Formate aus deiner Sammlung getrennt, darin nach Jahreszeit" },
    ];

    // Canonical season order used for consistent sorting across all schemes.
    const SEASON_ORDER = ["Frühling", "Sommer", "Herbst", "Winter", "Ganzjährig"];

    // Returns the single primary season for a perfume.
    // Rule: take the first SEASON_ORDER entry that appears in p.season.
    // If nothing matches (or season is empty) → "Ganzjährig".
    // This avoids the old .includes() bug where a perfume with
    // season="Frühling, Sommer" was placed in BOTH folders.
    function primarySeason(p) {
      const raw = (p.season || "").trim();
      if (!raw) return "Ganzjährig";
      return SEASON_ORDER.find(s => raw.includes(s)) || "Ganzjährig";
    }

    // Returns the primary family string (first entry of p.families array, or p.family fallback).
    function primaryFamily(p) {
      return (p.families && p.families.length > 0 ? p.families[0] : null) || p.family || "Sonstiges";
    }

    // Sorts an object's entries by a custom key order, then alphabetically for keys not in the order list.
    function sortedEntries(obj, orderedKeys) {
      return Object.entries(obj).sort(([a], [b]) => {
        const ia = orderedKeys.indexOf(a);
        const ib = orderedKeys.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;   // both known → use defined order
        if (ia !== -1) return -1;                       // only a known → a first
        if (ib !== -1) return 1;                        // only b known → b first
        return a.localeCompare(b);                      // both unknown → alphabetical
      });
    }

    // Format colors — defined once so format_season and any future scheme share them.
    const FORMAT_COLORS = { Flakon: "#993C1D", Probe: "#185FA5", Decant: "#3B6D11" };
    function formatColor(fmt) { return FORMAT_COLORS[fmt] || "#5F5E5A"; }

    function buildStructure(items, scheme) {
      const result = {};

      if (scheme === "season_family") {
        // Primary season → primary family. Each perfume appears exactly once.
        SEASON_ORDER.forEach(s => {
          const group = items.filter(p => primarySeason(p) === s);
          if (!group.length) return;
          const byFam = {};
          group.forEach(p => {
            const f = primaryFamily(p);
            if (!byFam[f]) byFam[f] = [];
            byFam[f].push(p);
          });
          result[s] = { color: SEASON_COLORS[s].accent, children: byFam, sortL2: "alpha" };
        });

      } else if (scheme === "family_season") {
        // Primary family → primary season. Each perfume appears exactly once.
        // L1 order: FAM_COLORS key order (stable), then alphabetical for unknowns.
        const famOrder = Object.keys(FAM_COLORS);
        const allFams = [...new Set(items.map(p => primaryFamily(p)))];
        allFams.sort((a, b) => {
          const ia = famOrder.indexOf(a), ib = famOrder.indexOf(b);
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          return a.localeCompare(b);
        });
        allFams.forEach(f => {
          const group = items.filter(p => primaryFamily(p) === f);
          if (!group.length) return;
          const bySeas = {};
          group.forEach(p => {
            const s = primarySeason(p);
            if (!bySeas[s]) bySeas[s] = [];
            bySeas[s].push(p);
          });
          result[f] = { color: FAM_COLORS[f] || "#5F5E5A", children: bySeas, sortL2: "season" };
        });

      } else if (scheme === "season_house") {
        // Primary season → house. Each perfume appears exactly once.
        SEASON_ORDER.forEach(s => {
          const group = items.filter(p => primarySeason(p) === s);
          if (!group.length) return;
          const byHouse = {};
          group.forEach(p => {
            const h = (p.house || "Unbekannt").trim();
            if (!byHouse[h]) byHouse[h] = [];
            byHouse[h].push(p);
          });
          result[s] = { color: SEASON_COLORS[s].accent, children: byHouse, sortL2: "alpha" };
        });

      } else if (scheme === "house_alpha") {
        // Alphabetical letter → house. Each perfume appears exactly once.
        // L1: first letter of house name (or "#" for non-letter starts).
        // L2: full house name, sorted A–Z.
        items.forEach(p => {
          const h = (p.house || "Unbekannt").trim();
          const letter = /^[A-Za-zÄÖÜäöüß]/.test(h) ? h[0].toUpperCase() : "#";
          if (!result[letter]) result[letter] = { color: "#534AB7", children: {}, sortL2: "alpha" };
          if (!result[letter].children[h]) result[letter].children[h] = [];
          result[letter].children[h].push(p);
        });
        // Sort L1 keys: A–Z, then "#" at the end
        const letters = Object.keys(result).sort((a, b) => {
          if (a === "#") return 1;
          if (b === "#") return -1;
          return a.localeCompare(b);
        });
        const sorted = {};
        letters.forEach(l => { sorted[l] = result[l]; });
        return sorted;

      } else if (scheme === "format_season") {
        // Format → primary season. Formats are derived dynamically from the actual
        // collection, not hardcoded, so "Miniatur" or any future format isn't lost.
        // Known formats appear first in a defined order; unknown formats follow alphabetically.
        const FORMAT_ORDER = ["Flakon", "Probe", "Decant"];
        const allFormats = [...new Set(items.map(p => p.format || "Probe"))];
        allFormats.sort((a, b) => {
          const ia = FORMAT_ORDER.indexOf(a), ib = FORMAT_ORDER.indexOf(b);
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          return a.localeCompare(b);
        });
        allFormats.forEach(fmt => {
          const group = items.filter(p => (p.format || "Probe") === fmt);
          if (!group.length) return;
          const bySeas = {};
          group.forEach(p => {
            const s = primarySeason(p);
            if (!bySeas[s]) bySeas[s] = [];
            bySeas[s].push(p);
          });
          result[fmt] = { color: formatColor(fmt), children: bySeas, sortL2: "season" };
        });
      }

      return result;
    }

    function OrdnerTab({ items, onSelectPerfume }) {
      const [scheme, setScheme] = useState("season_family");
      const [openL1, setOpenL1] = useState({});
      const [openL2, setOpenL2] = useState({});
      const [searchFilt, setSearch] = useState("");
      const [showPrint, setShowPrint] = useState(false);

      // Nur Proben (kein Flakon) in der physischen Ordnerstruktur
      const probenItems = useMemo(() => items.filter(p => p.format !== "Flakon"), [items]);
      const structure = useMemo(() => buildStructure(probenItems, scheme), [probenItems, scheme]);

      // Filter items by search
      const filteredItems = useMemo(() => {
        if (!searchFilt.trim()) return null;
        const q = searchFilt.toLowerCase();
        return probenItems.filter(p =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.house || "").toLowerCase().includes(q)
        );
      }, [probenItems, searchFilt]);

      function toggleL1(k) { setOpenL1(o => ({ ...o, [k]: !o[k] })); }
      function toggleL2(k) { setOpenL2(o => ({ ...o, [k]: !o[k] })); }
      function expandAll() {
        const l1 = {}, l2 = {};
        Object.keys(structure).forEach(k => {
          l1[k] = true;
          Object.keys(structure[k].children || {}).forEach(k2 => { l2[k + "/" + k2] = true; });
        });
        setOpenL1(l1); setOpenL2(l2);
      }
      function collapseAll() { setOpenL1({}); setOpenL2({}); }
      const hasAnyOpen = Object.values(openL1).some(Boolean) || Object.values(openL2).some(Boolean);

      // Find which folder a specific item belongs to (for search result)
      function findPath(item) {
        for (const [l1key, l1val] of Object.entries(structure)) {
          for (const [l2key, l2items] of Object.entries(l1val.children || {})) {
            if (l2items.some(p => p.id === item.id)) return [l1key, l2key];
          }
        }
        return ["?", "?"];
      }

      const totalFolders = Object.keys(structure).length;
      const totalSubfolders = Object.values(structure).reduce((s, v) => s + Object.keys(v.children || {}).length, 0);

      return (
        <div>
          {/* Header */}
          <div style={{ ...S.card, background: "#F9F8F5", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>Physische Ordnerstruktur</div>
                <div style={{ fontSize: 11, color: "#888780" }}>
                  {totalFolders} Hauptordner · {totalSubfolders} Unterordner · {probenItems.length} Proben (Flakons separat)
                </div>
              </div>
            </div>

            {/* Scheme selector */}
            <div style={S.lbl}>SORTIERUNG</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ORDNER_SCHEMES.map(sc => (
                <button key={sc.id} onClick={() => { setScheme(sc.id); setOpenL1({}); setOpenL2({}); }}
                  style={{
                    ...S.chip(scheme === sc.id), padding: "8px 12px", borderRadius: 8,
                    display: "flex", flexDirection: "column", alignItems: "flex-start", textAlign: "left"
                  }}>
                  <span style={{ fontSize: 12, fontWeight: scheme === sc.id ? 500 : 400 }}>{sc.label}</span>
                  <span style={{ fontSize: 10, opacity: .7, marginTop: 1 }}>{sc.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div style={{ position: "relative", marginBottom: 12 }}>
            <input id="folder-search" value={searchFilt} onChange={e => setSearch(e.target.value)}
              placeholder="Parfüm suchen → Ordner finden…"
              style={{ ...S.inp, paddingRight: 36 }} />
            {searchFilt && (
              <button onClick={() => setSearch("")}
                style={{
                  position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B4B2A9"
                }}>✕</button>
            )}
          </div>

          {/* Search results: show path */}
          {filteredItems && (
            <div style={{ ...S.card, marginBottom: 12 }}>
              <div style={S.lbl}>SUCHERGEBNIS ({filteredItems.length})</div>
              {filteredItems.length === 0 && (
                <div style={{ fontSize: 12, color: "#888780" }}>Kein Treffer.</div>
              )}
              {filteredItems.slice(0, 20).map(p => {
                const [l1, l2] = findPath(p);
                const l1color = structure[l1]?.color || "#888";
                return (
                  <div key={p.id} style={{
                    padding: "7px 0", borderBottom: "1px solid #F1EFE8",
                    display: "flex", justifyContent: "space-between", alignItems: "center"
                  }}>
                    <div>
                      <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: "inherit", textAlign: "left" }}>{p.name}</button>
                      <div style={{ fontSize: 10, color: "#888780", marginTop: 2 }}>
                        <span style={{ color: l1color, fontWeight: 500 }}>{l1}</span>
                        <span style={{ color: "#B4B2A9" }}> › </span>
                        <span>{l2}</span>
                      </div>
                    </div>
                    <span style={{ ...S.pill(FAM_COLORS[p.family] || "#888"), fontSize: 10 }}>{p.format}</span>
                  </div>
                );
              })}
              {filteredItems.length > 20 && (
                <div style={{ fontSize: 11, color: "#B4B2A9", marginTop: 6 }}>+{filteredItems.length - 20} weitere</div>
              )}
            </div>
          )}

          {/* Expand/Collapse all */}
          {!filteredItems && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={() => hasAnyOpen ? collapseAll() : expandAll()}
                style={{ ...S.btn("out"), flex: 1, fontSize: 11, padding: "8px" }}>
                {hasAnyOpen ? "Alles einklappen" : "Alles ausklappen"}
              </button>
            </div>
          )}

          {/* Tree structure */}
          {!filteredItems && Object.entries(structure).map(([l1key, l1val]) => {
            const isOpenL1 = openL1[l1key];
            const subCount = Object.keys(l1val.children || {}).length;
            const itemCount = Object.values(l1val.children || {}).flat().length;
            const color = l1val.color;
            // Sort L2 keys: kalendarisch for season sub-folders, alphabetical otherwise
            const l2Entries = l1val.sortL2 === "season"
              ? sortedEntries(l1val.children || {}, SEASON_ORDER)
              : Object.entries(l1val.children || {}).sort(([a], [b]) => a.localeCompare(b));

            return (
              <div key={l1key} style={{ marginBottom: 8 }}>
                {/* Level 1: Hauptordner */}
                <button onClick={() => toggleL1(l1key)}
                  aria-expanded={isOpenL1}
                  aria-label={`${l1key} – ${subCount} Unterordner, ${itemCount} Parfüms`}
                  style={{
                    width: "100%", background: "#fff", border: `1px solid ${color}44`,
                    borderRadius: 10, padding: "12px 14px", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                    borderLeft: `3px solid ${color}`
                  }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} aria-hidden="true" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: "#1A1A18", fontWeight: 500 }}>{l1key}</div>
                    <div style={{ fontSize: 10, color: "#888780", marginTop: 1 }}>
                      {subCount} Unterordner · {itemCount} Parfüms
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "#888780" }} aria-hidden="true">{isOpenL1 ? "▲" : "▼"}</div>
                </button>

                {/* Level 2: Unterordner */}
                <div style={{ marginLeft: 16, marginTop: 4, display: "grid", gridTemplateRows: isOpenL1 ? "1fr" : "0fr", opacity: isOpenL1 ? 1 : 0, transition: "grid-template-rows .25s ease, opacity .2s ease" }}>
                  <div style={{ overflow: "hidden" }}>
                  {l2Entries
                    .map(([l2key, l2items]) => {
                      const l2key_full = l1key + "/" + l2key;
                      const isOpenL2 = openL2[l2key_full];
                      const subColor = FAM_COLORS[l2key] || SEASON_COLORS[l2key]?.accent || "#888780";

                      return (
                        <div key={l2key} style={{ marginBottom: 4 }}>
                          {/* Level 2 header */}
                          <button onClick={() => toggleL2(l2key_full)}
                            aria-expanded={isOpenL2}
                            aria-label={`${l2key} – ${l2items.length} Parfüms`}
                            style={{
                              width: "100%", background: "#F9F8F5", border: "1px solid #E8E6E0",
                              borderRadius: 8, padding: "9px 12px", cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 8, textAlign: "left"
                            }}>
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: subColor, flexShrink: 0 }} aria-hidden="true" />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, color: "#1A1A18" }}>{l2key}</div>
                              <div style={{ fontSize: 10, color: "#888780" }}>{l2items.length} Parfüms</div>
                            </div>
                            <div style={{ fontSize: 10, color: "#B4B2A9" }} aria-hidden="true">{isOpenL2 ? "▲" : "▼"}</div>
                          </button>

                          {/* Level 3: Parfüms */}
                          <div style={{ marginLeft: 12, marginTop: 3, display: "grid", gridTemplateRows: isOpenL2 ? "1fr" : "0fr", opacity: isOpenL2 ? 1 : 0, transition: "grid-template-rows .22s ease, opacity .18s ease" }}>
                            <div style={{ overflow: "hidden" }}>
                            {[...l2items]
                              .sort((a, b) => (a.house || "").localeCompare(b.house || "") || (a.name || "").localeCompare(b.name || ""))
                              .map((p, idx) => (
                                <div key={p.id}
                                  style={{
                                    padding: "7px 10px",
                                    borderBottom: idx < l2items.length - 1 ? "1px solid #F1EFE8" : "none",
                                    background: "#fff",
                                    borderRadius: idx === 0 && l2items.length === 1 ? "6px" : idx === 0 ? "6px 6px 0 0" : idx === l2items.length - 1 ? "0 0 6px 6px" : "0",
                                    border: "1px solid #F1EFE8",
                                    borderTop: idx === 0 ? "1px solid #F1EFE8" : "none",
                                    display: "flex", justifyContent: "space-between", alignItems: "center"
                                  }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <button type="button" onClick={() => onSelectPerfume && onSelectPerfume(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontFamily: "inherit", color: "inherit", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", width: "100%" }}>
                                      {p.name}
                                    </button>
                                    <div style={{ fontSize: 10, color: "#888780", marginTop: 1 }}>
                                      {p.house}
                                      {p.conc ? ` · ${p.conc}` : ""}
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, marginLeft: 8 }}>
                                    <span style={{ ...S.pill(FAM_COLORS[p.family] || "#888"), fontSize: 9 }}>{p.format}</span>
                                    {(p.rating || 0) > 0 && <span style={{ fontSize: 10, color: "#BA7517" }}>{"★".repeat(Math.min(5, Math.max(0, Math.round(p.rating || 0))))}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>{/* inner overflow:hidden */}
                          </div>{/* grid wrapper L2 */}
                        </div>
                      );
                    })}
                  </div>{/* inner overflow:hidden */}
                </div>{/* grid wrapper L1 */}
              </div>
            );
          })}

          {/* Legend */}
          <div style={{ ...S.card, background: "#F9F8F5", marginTop: 4 }}>
            <div style={S.lbl}>LEGENDE</div>
            <div style={{ fontSize: 11, color: "#888780", lineHeight: 1.8 }}>
              <div>◼ Hauptordner = physischer Karton / Regalfach</div>
              <div>● Unterordner = Trennkarte oder Gruppe</div>
              <div style={{ marginTop: 4 }}>Jedes Parfüm erscheint genau einmal (primäre Saison / Familie).</div>
              <div>Parfüms innerhalb: nach Haus A–Z, dann Name A–Z sortiert.</div>
            </div>
          </div>
        </div>
      );
    }

    function SettingsSection({ title, icon, children, defaultOpen = false }) {
      const [open, setOpen] = useState(defaultOpen);
      return (
        <div style={{ ...S.card, marginBottom: 10, overflow: "hidden" }}>
          <button onClick={() => setOpen(o => !o)} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            width: "100%", background: "none", border: "none", cursor: "pointer",
            padding: 0, fontFamily: "'Georgia',serif", textAlign: "left"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>{icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#1A1A18" }}>{title}</span>
            </div>
            <span style={{
              fontSize: 12, color: "#B4B2A9", transition: "transform .2s",
              transform: open ? "rotate(180deg)" : "none", display: "inline-block"
            }}>▾</span>
          </button>
          {open && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #F1EFE8", animation: "fadeIn .15s ease-out both" }}>
              {children}
            </div>
          )}
        </div>
      );
    }

    // ── Groq Rate-Limit Status Widget ────────────────────────────────────────────
    function GroqRateLimitStatus() {
      const countdown = useGroqCountdown();
      const [cacheCount, setCacheCount] = useState(0);
      const [modelStatus, setModelStatus] = useState([]);
      useEffect(() => {
        try {
          const all = JSON.parse(localStorage.getItem("parfum_groq_cache_v1") || "{}");
          setCacheCount(Object.keys(all).length);
        } catch {}
        // Live Model-Status aus GTM
        const now = Date.now();
        setModelStatus(GTM_MODEL_POOL.map(m => {
          const s = _gtmState[m.id];
          const blocked = s.blockedUntil > now;
          return { id: m.id.split("-").slice(0,3).join("-"), blocked, req: s.reqRemainingDay, tok: s.tokRemaining, quality: m.quality };
        }));
      }, [countdown]);

      return (
        <div style={{ marginTop: 12 }}>
          {countdown > 0 && (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#FFF8EE", border: "1px solid #BA751744", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>⏱</span>
                <div>
                  <div style={{ fontSize: 12, color: "#BA7517", fontWeight: 500 }}>Hauptmodell geblockt</div>
                  <div style={{ fontSize: 11, color: "#888780" }}>Rotation aktiv · frei in <strong>{countdown}s</strong></div>
                </div>
              </div>
            </div>
          )}
          {/* Model Pool Status */}
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "#F9F8F5", border: "1px solid #E8E6E0" }}>
            <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9", marginBottom: 8 }}>MODEL POOL STATUS</div>
            {modelStatus.map((m, i) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: i < modelStatus.length-1 ? 5 : 0 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.blocked ? "#E24B4A" : "#1D9E75", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#1A1A18", flex: 1, fontFamily: "monospace" }}>{m.id}</span>
                <span style={{ fontSize: 10, color: m.blocked ? "#E24B4A" : "#888780" }}>{m.blocked ? "geblockt" : `${m.req} req übrig`}</span>
              </div>
            ))}
            {cacheCount > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #F1EFE8", fontSize: 11, color: "#1D9E75" }}>
                ◎ {cacheCount} Antworten gecacht
              </div>
            )}
          </div>
        </div>
      );
    }

    function EinstellungenTab({ items, onImport, onExport, onAdd, onClearAll, onClearAllData, appName, onSetAppName, userNotePrefs, setUserNotePrefs, userFamilyPrefs, setUserFamilyPrefs }) {
      const [drag, setDrag] = useState(false);
      // msg can be { text, type: "ok"|"err" } — renders green or red accordingly
      const [msg, setMsg] = useState(null);
      const [confirmMode, setConfirmMode] = useState(null); // null | "items" | "all"
      const [linkUrl, setLinkUrl] = useState("");
      const [loading, setLoading] = useState(false);
      const [status, setStatus] = useState("");
      const [preview, setPreview] = useState(null);
      const [linkErr, setLinkErr] = useState("");
      const [format, setFormat] = useState("Probe");
      // Sync nameInput with appName prop (e.g. after external reset)
      const [nameInput, setNameInput] = useState(appName);
      useEffect(() => { setNameInput(appName); }, [appName]);

      const [groqKeyDraft, setGroqKeyDraft] = useState(() => {
        try { return localStorage.getItem(KEYS.groqKey) || ""; } catch { return ""; }
      });
      const [groqKeyMsg, setGroqKeyMsg] = useState("");

      function showMsg(text, type = "ok") {
        setMsg({ text, type });
        setTimeout(() => setMsg(null), 4000);
      }

      function handleFile(file) {
        if (!file) return;
        if (file.size > MAX_IMPORT_BYTES) { showMsg("Datei zu groß (max. 2 MB).", "err"); return; }
        const reader = new FileReader();
        reader.onerror = () => showMsg("Datei konnte nicht gelesen werden.", "err");
        reader.onload = e => {
          const parsed = parseTSV(e.target.result);
          if (!parsed.length) { showMsg("Keine Einträge – TSV-Format prüfen.", "err"); return; }
          // Merge: existing items matched by URL keep their ID; new items get new IDs.
          // This appends to the collection rather than replacing it.
          const urlToId = {};
          items.forEach(ex => { if (ex.url) urlToId[ex.url] = ex.id; });
          const merged = parsed.map(p => ({ ...p, id: (p.url && urlToId[p.url]) ? urlToId[p.url] : p.id }));
          // Items already in collection (matched by ID) are updated; new items are appended.
          const existingIds = new Set(items.map(p => p.id));
          const updatedItems = items.map(p => {
            const incoming = merged.find(m => m.id === p.id);
            return incoming ? { ...p, ...incoming } : p;
          });
          const newItems = merged.filter(m => !existingIds.has(m.id));
          onImport([...updatedItems, ...newItems]);
          showMsg(`✓ ${newItems.length} neu importiert, ${merged.length - newItems.length} aktualisiert.`);
        };
        reader.readAsText(file, "utf-8");
      }

      async function handleLookup() {
        const url = linkUrl.trim();
        if (!url) { setLinkErr("Bitte URL eingeben."); return; }
        // Duplicate check: warn if URL is already in collection
        const alreadyExists = items.some(p => p.url && p.url === url);
        setLoading(true); setLinkErr(""); setPreview(null); setStatus("Suche Parfumo-Seite…");
        try {
          const result = await lookupByUrl(url);
          const safeUrl = validateParfumoLookupUrl(url);
          setPreview({ ...result, url: safeUrl, format, rating: 0, id: newId() });
          setStatus(alreadyExists ? "⚠ Diese URL ist bereits in deiner Sammlung." : "");
        } catch (e) {
          setLinkErr(`Fehler: ${e.message}`); setStatus("");
        }
        setLoading(false);
      }

      function confirmAdd() {
        if (!preview || !preview.name?.trim()) { setLinkErr("Name fehlt."); return; }
        onAdd({ ...preview, format });
        const name = preview.name;
        setPreview(null); setLinkUrl(""); setStatus(""); showMsg(`✓ "${name}" hinzugefügt.`);
      }

      const totalPrefSelected = (userNotePrefs?.length || 0) + (userFamilyPrefs?.length || 0);

      return (
        <div>
          {/* ── Präferenzen ─────────────────────────────────────── */}
          <SettingsSection title="Präferenzen" icon="◈" defaultOpen={true}>
            {/* App-Name */}
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #F1EFE8" }}>
              <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9", marginBottom: 8 }}>APP-NAME</div>
              <div style={{ display: "flex", gap: 8 }}>
                <label htmlFor="settings-app-name" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>App-Name</label>
                <input id="settings-app-name" value={nameInput} onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && onSetAppName(nameInput.trim() || "Sillage")}
                  style={{ ...S.inp, flex: 1, fontSize: 13 }} placeholder="Sillage" />
                <button onClick={() => onSetAppName(nameInput.trim() || "Sillage")}
                  style={{ ...S.btn("pri"), padding: "10px 14px", fontSize: 12 }}>OK</button>
              </div>
            </div>

            {/* Duftpräferenzen */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9" }}>LIEBLINGSDUFTFAMILIEN</div>
                {(userFamilyPrefs || []).length > 0 && (
                  <button onClick={() => setUserFamilyPrefs([])} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", fontFamily: "inherit" }}>
                    Alle löschen
                  </button>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                {[...FAMILIES].sort((a, b) => a.localeCompare(b)).map(fam => {
                  const isSelected = userFamilyPrefs && userFamilyPrefs.includes(fam);
                  const col = FAM_COLORS[fam] || "#534AB7";
                  return (
                    <button key={fam} onClick={() => {
                      const current = userFamilyPrefs || [];
                      setUserFamilyPrefs(isSelected ? current.filter(f => f !== fam) : [...current, fam]);
                    }} style={{
                      fontSize: 11, padding: "6px 12px", borderRadius: 16, cursor: "pointer",
                      border: isSelected ? `1.5px solid ${col}` : "1px solid #E8E6E0",
                      background: isSelected ? col : "#fff",
                      color: isSelected ? "#fff" : "#888780", transition: "all .12s",
                    }}>{fam}</button>
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 10, letterSpacing: "1px", color: "#B4B2A9" }}>BEVORZUGTE NOTEN-TYPEN</div>
                {(userNotePrefs || []).length > 0 && (
                  <button onClick={() => setUserNotePrefs([])} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#B4B2A9", fontFamily: "inherit" }}>
                    Alle löschen
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#B4B2A9", marginBottom: 8, lineHeight: 1.5 }}>
                Beeinflusst die Empfehlungs-Engine – je mehr ausgewählt, desto personalisierter.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[...NOTE_CATEGORIES].sort((a, b) => a.localeCompare(b)).map(cat => {
                  const isSelected = userNotePrefs && userNotePrefs.includes(cat);
                  return (
                    <button key={cat} onClick={() => {
                      const current = userNotePrefs || [];
                      setUserNotePrefs(isSelected ? current.filter(c => c !== cat) : [...current, cat]);
                    }} style={{
                      fontSize: 11, padding: "6px 12px", borderRadius: 16, cursor: "pointer",
                      border: isSelected ? `1.5px solid ${NOTE_CAT_COLORS[cat] || "#534AB7"}` : "1px solid #E8E6E0",
                      background: isSelected ? (NOTE_CAT_COLORS[cat] || "#534AB7") : "#fff",
                      color: isSelected ? "#fff" : "#888780", transition: "all .12s",
                    }}>{cat}</button>
                  );
                })}
              </div>
              {totalPrefSelected > 0 && (
                <div style={{ fontSize: 10, color: "#1D9E75", marginTop: 10 }}>
                  ✓ {totalPrefSelected} Präferenz{totalPrefSelected !== 1 ? "en" : ""} aktiv – Empfehlungen sind personalisiert
                </div>
              )}
            </div>
          </SettingsSection>

          {/* ── API ─────────────────────────────────────────────── */}
          <SettingsSection title="API & Datenquellen" icon="⌗">
            <div style={{ fontSize: 11, color: "#888780", marginBottom: 10, lineHeight: 1.6 }}>
              Kostenloser Groq-Key unter{" "}
              <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
                style={{ color: "#185FA5" }}>console.groq.com/keys</a>
              {" "}– lokal gespeichert. Free-Tier: 30 Req/Min, 1.000/Tag.
              Token Manager rotiert automatisch zwischen 3 Modellen.
            </div>
            <label htmlFor="groq-key" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Groq API Key</label>
            <input id="groq-key" type="password" autoComplete="off" spellCheck={false}
              value={groqKeyDraft}
              onChange={e => { setGroqKeyDraft(e.target.value); setGroqKeyMsg(""); }}
              placeholder="gsk_…"
              style={{ ...S.inp, marginBottom: 10, fontFamily: "ui-monospace,monospace", fontSize: 12 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => {
                const t = groqKeyDraft.trim();
                // Validate format: Groq keys start with "gsk_" and are at least 30 chars
                if (!t.startsWith("gsk_") || t.length < 30) {
                  setGroqKeyMsg('Ungültiger Schlüssel – Groq-Keys beginnen mit "gsk_".');
                  return;
                }
                try { localStorage.setItem(KEYS.groqKey, t); setGroqKeyMsg("✓ Gespeichert."); }
                catch { setGroqKeyMsg("Speichern fehlgeschlagen."); }
              }} style={{ ...S.btn("pri"), padding: "10px 16px" }}>Speichern</button>
              <button type="button" onClick={() => {
                try { localStorage.removeItem(KEYS.groqKey); } catch { }
                setGroqKeyDraft(""); setGroqKeyMsg("Schlüssel entfernt.");
              }} style={{ ...S.btn("out"), padding: "10px 16px" }}>Entfernen</button>
            </div>
            {groqKeyMsg && <div style={{ fontSize: 12, marginTop: 8, color: groqKeyMsg.includes("✓") ? "#1D9E75" : "#993C1D" }}>{groqKeyMsg}</div>}
            <GroqRateLimitStatus />
          </SettingsSection>

          {/* ── Daten ───────────────────────────────────────────── */}
          <SettingsSection title="Daten & Backup" icon="◎">
            {/* Parfumo-Link */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "#888780", marginBottom: 10, lineHeight: 1.5 }}>
                Parfumo-URL eingeben → Daten werden automatisch extrahiert.
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "#B4B2A9", marginBottom: 6 }}>FORMAT</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["Probe", "Flakon", "Decant"].map(f => (
                    <button key={f} onClick={() => setFormat(f)}
                      style={{ ...S.chip(format === f), padding: "6px 14px", fontSize: 11 }}>{f}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <label htmlFor="parfumo-url" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Parfumo URL</label>
                <input id="parfumo-url" value={linkUrl} onChange={e => { setLinkUrl(e.target.value); setLinkErr(""); setStatus(""); }}
                  onKeyDown={e => e.key === "Enter" && !loading && handleLookup()}
                  placeholder="https://www.parfumo.de/Parfums/…"
                  style={{ ...S.inp, flex: 1, fontSize: 12 }} />
                <button onClick={handleLookup} disabled={loading || !linkUrl.trim()}
                  style={{ ...S.btn("pri"), padding: "10px 14px", opacity: loading || !linkUrl.trim() ? 0.5 : 1 }}>
                  {loading ? "…" : "Laden"}
                </button>
              </div>
              {status && <div style={{ fontSize: 11, color: status.startsWith("⚠") ? "#BA7517" : "#888780", marginBottom: 6 }}>{status}</div>}
              {linkErr && <div style={{ fontSize: 11, color: "#E24B4A", marginBottom: 6 }}>{linkErr}</div>}
              {preview && (
                <div style={{ background: "#F1EFE8", borderRadius: 10, padding: "14px", marginTop: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Vorschau</div>
                  <div style={{ display: "grid", gap: 7, marginBottom: 10 }}>
                    <input value={preview.name || ""} onChange={e => setPreview(p => ({ ...p, name: e.target.value }))}
                      placeholder="Name *" style={{ ...S.inp, fontSize: 12 }} />
                    <input value={preview.house || ""} onChange={e => setPreview(p => ({ ...p, house: e.target.value }))}
                      placeholder="Haus" style={{ ...S.inp, fontSize: 12 }} />
                    <textarea value={preview.top || ""} onChange={e => setPreview(p => ({ ...p, top: e.target.value }))}
                      placeholder="Kopfnoten" style={{ ...S.ta, minHeight: 48, fontSize: 12 }} />
                    <textarea value={preview.middle || ""} onChange={e => setPreview(p => ({ ...p, middle: e.target.value }))}
                      placeholder="Herznoten" style={{ ...S.ta, minHeight: 48, fontSize: 12 }} />
                    <textarea value={preview.base || ""} onChange={e => setPreview(p => ({ ...p, base: e.target.value }))}
                      placeholder="Basisnoten" style={{ ...S.ta, minHeight: 48, fontSize: 12 }} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={confirmAdd} style={{ ...S.btn("pri"), flex: 1, padding: "10px" }}>
                      Hinzufügen als {format}
                    </button>
                    <button onClick={() => { setPreview(null); setStatus(""); }} style={{ ...S.btn("out"), padding: "10px" }}>✕</button>
                  </div>
                </div>
              )}
            </div>

            {/* TSV Import */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#B4B2A9", marginBottom: 8 }}>TSV IMPORTIEREN</div>
              <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={e => { e.preventDefault(); setDrag(false); }}
                onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
                style={{
                  border: `2px dashed ${drag ? "#534AB7" : "#D3D1C7"}`,
                  borderRadius: 10, padding: "20px", textAlign: "center", marginBottom: 8,
                  background: drag ? "#EEEDFE" : "transparent",
                  transition: "all .15s",
                  transform: drag ? "scale(1.01)" : "scale(1)",
                }}>
                <div style={{ fontSize: 24, marginBottom: 4, transition: "transform .15s", transform: drag ? "scale(1.2)" : "scale(1)" }}>◎</div>
                <div style={{ fontSize: 12, marginBottom: 2 }}>{drag ? "Loslassen zum Importieren" : "TSV hier ablegen"}</div>
                <div style={{ fontSize: 11, color: "#888780" }}>{drag ? "" : "oder per Knopf auswählen"}</div>
              </div>
              <label style={{ display: "block" }}>
                <input type="file" accept=".tsv,.txt,.csv" onChange={e => handleFile(e.target.files[0])} style={{ display: "none" }} />
                <span style={{ ...S.btn("out"), display: "block", textAlign: "center", padding: "10px", cursor: "pointer" }}>
                  Datei auswählen
                </span>
              </label>
              {msg && (
                <div style={{ fontSize: 12, marginTop: 8, textAlign: "center", color: msg.type === "err" ? "#993C1D" : "#1D9E75" }}>
                  {msg.text}
                </div>
              )}
            </div>

            {/* Export */}
            <div>
              <button onClick={onExport} style={{ ...S.btn("out"), width: "100%" }}>
                TSV exportieren ({items.length} Einträge)
              </button>
              <div style={{ fontSize: 11, color: "#888780", marginTop: 6 }}>Tab-getrennt, UTF-8 inkl. Bewertungen.</div>
            </div>
          </SettingsSection>

          {/* ── Gefahrenzone ────────────────────────────────────── */}
          <SettingsSection title="Gefahrenzone" icon="⚠">
            {confirmMode ? (
              <div>
                {confirmMode === "items" ? (
                  <div style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>
                    Alle {items.length} Parfüms wirklich löschen?<br />
                    <span style={{ fontSize: 11, color: "#888780" }}>Log, Notizen und Einstellungen bleiben erhalten.</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#A32D2D", marginBottom: 12 }}>
                    Wirklich <strong>alle Daten</strong> löschen?<br />
                    <span style={{ fontSize: 11, color: "#888780" }}>Sammlung, Log, Notizen, Füllstände – alles wird unwiderruflich gelöscht.</span>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => {
                    if (confirmMode === "items") onClearAll();
                    else if (onClearAllData) onClearAllData();
                    setConfirmMode(null);
                  }} style={{ ...S.btn("pri"), background: "#E24B4A", flex: 1 }}>
                    Ja, löschen
                  </button>
                  <button onClick={() => setConfirmMode(null)} style={{ ...S.btn("out"), flex: 1 }}>Abbrechen</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={() => setConfirmMode("items")}
                  style={{ ...S.btn("out"), width: "100%", color: "#A32D2D", borderColor: "#F09595" }}>
                  Sammlung leeren
                </button>
                <button onClick={() => setConfirmMode("all")}
                  style={{ ...S.btn("out"), width: "100%", color: "#A32D2D", borderColor: "#F09595", fontSize: 12 }}>
                  Alle Daten zurücksetzen
                </button>
              </div>
            )}
          </SettingsSection>

          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
        </div>
      );
    }


    class AppErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, message: "" };
      }
      static getDerivedStateFromError(err) {
        return { hasError: true, message: String(err?.message || err || "Unbekannter Fehler") };
      }
      componentDidCatch(err) {
        try {
          console.error("AppErrorBoundary", err);
        } catch { }
      }
      render() {
        if (this.state.hasError) {
          return React.createElement("div", { style: { maxWidth: 480, margin: "30px auto", padding: 16, fontFamily: "Georgia,serif" } },
            React.createElement("div", { style: { background: "#fff", border: "1px solid #F7C1C1", borderRadius: 10, padding: 14 } },
              React.createElement("div", { style: { fontSize: 14, color: "#A32D2D", marginBottom: 6 } }, "Etwas ist schiefgelaufen."),
              React.createElement("div", { style: { fontSize: 12, color: "#666", marginBottom: 10 } }, this.state.message),
              React.createElement("button", { onClick: () => location.reload(), style: { padding: "8px 12px", borderRadius: 8, border: "1px solid #D3D1C7", background: "#fff", cursor: "pointer" } }, "App neu laden")
            )
          );
        }
        return this.props.children;
      }
    }

    // ── Main App ──────────────────────────────────────────────────────────────────
        function App() {
      // ═══════════════════════════════════════════════════════════════════
      // Zentraler App-State via useReducer – alle Daten in einem Objekt
      // ══════════════════════════════════════════════════════════════════
      const [state, dispatch] = useReducer((s, a) => {
        switch (a.type) {
          case 'HYDRATE_ALL': return { ...s, ...a.payload };
          case 'SET_ITEMS': return { ...s, items: a.payload };
          case 'SET_LOG': return { ...s, log: a.payload };
          case 'SET_NOTES': return { ...s, notes: a.payload };
          case 'SET_WISHLIST': return { ...s, wishlist: a.payload };
          case 'SET_WISH_DETAILS_CACHE': return { ...s, wishDetailsCache: a.payload };
          case 'SET_PREFS': return { ...s, prefs: a.payload };
          case 'SET_USER_NOTE_PREFS': return { ...s, userNotePrefs: a.payload };
          case 'SET_USER_FAMILY_PREFS': return { ...s, userFamilyPrefs: a.payload };
          case 'SET_FILL_LEVELS': return { ...s, fillLevels: a.payload };
          case 'SET_PRICE_ML': return { ...s, priceMl: a.payload };
          case 'SET_TAB': return { ...s, tab: a.payload };
          case 'SET_TOAST': return { ...s, toast: a.payload };
          case 'SET_LOADED': return { ...s, loaded: a.payload };
          case 'SET_BACK_STACK': return { ...s, backStack: a.payload };
          case 'SET_DETAIL': return { ...s, detail: a.payload };
          case 'SET_SHOW_ONBOARD': return { ...s, showOnboard: a.payload };
          default: return s;
        }
      }, {
        items: [], log: [], notes: {},
        wishlist: [], wishDetailsCache: {},
        prefs: { appName: "Sillage" }, userNotePrefs: [], userFamilyPrefs: [],
        fillLevels: {}, priceMl: {},
        tab: "heute", toast: { msg: "", show: false }, loaded: false,
        backStack: [], detail: null, showOnboard: false,
      });
      const { errors, pushError, dismiss } = useErrorSystem();
      // ── Hydration (einmalig beim Mount) ──────────────────────────
      useEffect(() => {
        (async () => {
          try {
            dispatch({ type: 'HYDRATE_ALL', payload: {
              items: hydrateItems(localStorage.getItem(KEYS.items)),
              log: hydrateLog(localStorage.getItem(KEYS.log)),
              notes: hydrateNotes(localStorage.getItem(KEYS.notes)),
              wishlist: hydrateWishlist(localStorage.getItem(KEYS.wishlist)),
              prefs: hydratePrefs(localStorage.getItem(KEYS.prefs)),
              fillLevels: hydrateFillLevels(localStorage.getItem(KEYS.fillLevels)),
              priceMl: hydratePriceMl(localStorage.getItem(KEYS.priceMl)),
            } });
            const savedNotePrefs = localStorage.getItem(KEYS.userNotePrefs);
            if (savedNotePrefs) dispatch({ type: 'SET_USER_NOTE_PREFS', payload: safeParseJSON(savedNotePrefs, []) });
            const savedFamilyPrefs = localStorage.getItem(KEYS.userFamilyPrefs);
            if (savedFamilyPrefs) dispatch({ type: 'SET_USER_FAMILY_PREFS', payload: safeParseJSON(savedFamilyPrefs, []) });
            const r7 = localStorage.getItem(KEYS.onboarding);
            if (!r7) dispatch({ type: 'SET_SHOW_ONBOARD', payload: true });
            else { const ob = safeParseJSON(r7, null); if (!ob || !ob.done) dispatch({ type: 'SET_SHOW_ONBOARD', payload: true }); }
          } catch (e) { pushError(e); }
          dispatch({ type: 'SET_LOADED', payload: true });
        })();
      }, []);

      const saveItems = useCallback(async n => { dispatch({ type: 'SET_ITEMS', payload: n }); try { localStorage.setItem(KEYS.items, JSON.stringify(n)); } catch (e) { pushError(e); } }, [pushError]);
      const saveLog = useCallback(async n => { dispatch({ type: 'SET_LOG', payload: n }); try { localStorage.setItem(KEYS.log, JSON.stringify(n)); } catch { } }, []);
      const saveNotes = useCallback(async n => { dispatch({ type: 'SET_NOTES', payload: n }); try { localStorage.setItem(KEYS.notes, JSON.stringify(n)); } catch { } }, []);
      const saveWishlist = useCallback(async n => { dispatch({ type: 'SET_WISHLIST', payload: n }); try { localStorage.setItem(KEYS.wishlist, JSON.stringify(n)); } catch { } }, []);
      const savePrefs = useCallback(async n => { dispatch({ type: 'SET_PREFS', payload: n }); try { localStorage.setItem(KEYS.prefs, JSON.stringify(n)); } catch { } }, []);
      const saveUserNotePrefs = useCallback(async n => { dispatch({ type: 'SET_USER_NOTE_PREFS', payload: n }); try { localStorage.setItem(KEYS.userNotePrefs, JSON.stringify(n)); } catch { } }, []);
      const saveUserFamilyPrefs = useCallback(async n => { dispatch({ type: 'SET_USER_FAMILY_PREFS', payload: n }); try { localStorage.setItem(KEYS.userFamilyPrefs, JSON.stringify(n)); } catch { } }, []);
      const saveFillLevels = useCallback(async n => { dispatch({ type: 'SET_FILL_LEVELS', payload: n }); try { localStorage.setItem(KEYS.fillLevels, JSON.stringify(n)); } catch { } }, []);
      const savePriceMl = useCallback(async n => { dispatch({ type: 'SET_PRICE_ML', payload: n }); try { localStorage.setItem(KEYS.priceMl, JSON.stringify(n)); } catch { } }, []);

      // Debounced versions for frequent updates (500ms delay)
      const saveItemsDebounced = useMemo(() => debounce(n => {
        try { localStorage.setItem(KEYS.items, JSON.stringify(n)); } catch (e) { pushError(e); }
      }, 500), [pushError]);
      const saveLogDebounced = useMemo(() => debounce(n => {
        try { localStorage.setItem(KEYS.log, JSON.stringify(n)); } catch { }
      }, 500), []);
      const saveNotesDebounced = useMemo(() => debounce(n => {
        try { localStorage.setItem(KEYS.notes, JSON.stringify(n)); } catch { }
      }, 500), []);
      const saveFillLevelsDebounced = useMemo(() => debounce(n => {
        try { localStorage.setItem(KEYS.fillLevels, JSON.stringify(n)); } catch { }
      }, 500), []);
      const savePriceMlDebounced = useMemo(() => debounce(n => {
        try { localStorage.setItem(KEYS.priceMl, JSON.stringify(n)); } catch { }
      }, 500), []);

            const handleImport = useCallback(p => {
        const validated = (Array.isArray(p) ? p : []).map(item => sanitizePerfume(item)).map(item => ({
          ...item,
          fillLevel: item.format === "Flakon" ? item.fillLevel : undefined,
        })).filter(x => x.name);
        saveItems(validated);
      }, [saveItems]);
      const handleAdd = useCallback(p => {
        const safe = sanitizePerfume(p);
        if (!safe.name) return;
        saveItems([...state.items, safe]);
      }, [state.items, saveItems]);
      const handleDelete = useCallback(id => saveItems(state.items.filter(p => p.id !== id)), [state.items, saveItems]);
      const handleUpdate = useCallback((id, ch) => saveItems(state.items.map(p => p.id === id ? sanitizePerfume({ ...p, ...(ch || {}) }) : p)), [state.items, saveItems]);
      const handleLog = useCallback(p => {
        const next = [...state.log, { id: p.id, ts: Date.now() }].slice(-1000);
        dispatch({ type: 'SET_LOG', payload: next });
        // Use immediate save (not debounced) so a log entry is never lost if the
        // user closes the app within the 500 ms debounce window.
        try { localStorage.setItem(KEYS.log, JSON.stringify(next)); } catch { }
        dispatch({ type: 'SET_TOAST', payload: { msg: "✓ Getragen", show: true } });
        setTimeout(() => dispatch({ type: 'SET_TOAST', payload: t => ({ ...t, show: false }) }), 2000);
      }, [state.log]);
      const handleExport = useCallback(() => downloadTSV(state.items), [state.items]);
      // Full data reset: clears items, log, notes, fill levels, price data.
      // Preserves prefs (app name), API key, and user preference selections.
      const handleClearAllData = useCallback(() => {
        saveItems([]);
        saveLog([]);
        saveNotes({});
        saveFillLevels({});
        savePriceMl({});
      }, [saveItems, saveLog, saveNotes, saveFillLevels, savePriceMl]);
      const handleSaveNote = useCallback((pid, pnotes) => {
        const next = { ...state.notes, [pid]: pnotes };
        dispatch({ type: 'SET_NOTES', payload: next });
        saveNotesDebounced(next);
      }, [state.notes, saveNotesDebounced]);
      const handleSetAppName = useCallback(name => savePrefs({ ...state.prefs, appName: name }), [state.prefs, savePrefs]);
      const handleSetFill = useCallback((id, level) => {
        // STRICT: only allow fill level for Flakons
        const item = state.items.find(p => p.id === id);
        if (!item || item.format !== "Flakon") return;
        const next = level === null ? { ...state.fillLevels } : { ...state.fillLevels, [id]: level };
        if (level === null) delete next[id];
        dispatch({ type: 'SET_FILL_LEVELS', payload: next });
        saveFillLevelsDebounced(next);
      }, [state.items, state.fillLevels, saveFillLevelsDebounced]);
      const handleSavePriceMl = useCallback((id, data) => {
        const next = { ...state.priceMl, [id]: data };
        dispatch({ type: 'SET_PRICE_ML', payload: next });
        savePriceMlDebounced(next);
      }, [state.priceMl, savePriceMlDebounced]);

      // Onboarding completion
      const handleOnboardComplete = useCallback(async (data) => {
        dispatch({ type: 'SET_SHOW_ONBOARD', payload: false });
        try {
          localStorage.setItem(KEYS.onboarding, JSON.stringify({ done: true, data, ts: Date.now() }));
        } catch (e) { pushError(e); }
        if (data) {
          // Merge: families from explicit family selection + style-mapped families
          const styleFamilies = ONBOARD_STYLES.filter(s => (data.styles || []).includes(s.id)).map(s => s.family);
          const directFamilies = data.favFamilies || [];
          const merged = [...new Set([...directFamilies, ...styleFamilies])];
          savePrefs({ ...state.prefs, favFamilies: merged, favOccs: data.occasions || [] });
          if (merged.length) saveUserFamilyPrefs(merged);
        }
      }, [state.prefs, savePrefs, saveUserFamilyPrefs, pushError]);

      // Fill-level warnings for low Flakons
      const lowFillWarnings = useMemo(() =>
        state.items.filter(p => p.format === "Flakon" && state.fillLevels[p.id] !== undefined && state.fillLevels[p.id] <= 25)
        , [state.items, state.fillLevels]);

      const wishCount = state.wishlist.length;
      const declutterCount = useMemo(() => getDeclutterSuggestions(state.items, state.log).length, [state.items, state.log]);

      const TABS = [
        { id: "heute", l: "HEUTE", i: "☀" },
        { id: "sammlung", l: "SAMMLUNG", i: "✦" },
        { id: "statistik", l: "STATISTIK", i: "◉" },
        { id: "ordner", l: "ORDNER", i: "▤" },
        { id: "layering", l: "LAYERING", i: "✧" },
        { id: "declutter", l: `VERGESSEN`, i: "↺", badge: declutterCount > 0 ? declutterCount : null },
        { id: "wunschliste", l: "WÜNSCHE", i: "♡", badge: wishCount > 0 ? wishCount : null },
        { id: "settings", l: "SETTINGS", i: "⚙" },
      ];

      // App-level detail overlay state
      const appDetailPerfume = state.detail ? state.items.find(x => x.id === state.detail) || null : null;
      const appDetailRef = useRef(null);
      useBodyLock(!!appDetailPerfume || state.showOnboard);

      if (!state.loaded) return (
        <div style={{ ...S.app, alignItems: "center", justifyContent: "center", background: "#FAFAF8" }} role="status" aria-live="polite">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 16, animation: "breathe 2s ease-in-out infinite" }}>◇</div>
            <div style={{ color: "#888780", fontSize: 13, letterSpacing: "1px", animation: "pulse 2s ease-in-out infinite" }}>Lädt…</div>
          </div>
        </div>
      );

      return (
        <div style={S.app}>
          {/* Error Banner */}
          <ErrorBanner errors={errors} onDismiss={dismiss} />

          {/* Toast Notification */}
          {state.toast.show && (
            <div style={{
              position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
              background: "#1A1A18", color: "#fff", padding: "12px 24px", borderRadius: 24,
              fontSize: 13, boxShadow: "0 8px 30px rgba(26,26,24,0.3)", zIndex: 9999,
              animation: "fadeIn .3s ease-out"
            }}>
              {state.toast.msg}
            </div>
          )}

          {/* Onboarding Modal */}
          {state.showOnboard && state.items.length === 0 && (
            <OnboardingModal onComplete={handleOnboardComplete} />
          )}

          <header style={S.hdr}>
            <h1 style={{
              fontSize: 20, fontWeight: 400, letterSpacing: "-0.5px", color: "#1A1A18",
              margin: "0 0 14px", display: "flex", alignItems: "baseline", gap: 8
            }}>
              {state.prefs.appName}
              <span style={{ fontSize: 11, color: "#B4B2A9", fontWeight: 400, letterSpacing: "0.5px" }}>
                {state.items.length > 0 ? `${state.items.length} parfüms` : ""}
              </span>
            </h1>
            <nav style={S.tabs} role="tablist" aria-label="Hauptnavigation">
              {TABS.map(t => (
                <button key={t.id} role="tab"
                  aria-selected={state.tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  id={`tab-${t.id}`}
                  onClick={() => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_TAB', payload: t.id }); }}
                  style={{ ...S.tab(state.tab === t.id), whiteSpace: "nowrap", position: "relative" }}>
                  <span style={{ marginRight: 1, fontSize: 9 }}>{t.i}</span>{t.l}
                  {t.badge && <span style={{
                    position: "absolute", top: 1, right: 1, fontSize: 6, background: "#E24B4A", color: "#fff",
                    borderRadius: 5, minWidth: 10, height: 10, lineHeight: "10px", textAlign: "center", padding: "0 2px"
                  }}>{t.badge}</span>}
                </button>
              ))}
            </nav>
          </header>
          <PullToRefresh tabKey={state.tab}>
            <main key={state.tab} style={{...S.body, animation: "fadeInUp .18s ease-out both"}} role="tabpanel" id={`panel-${state.tab}`} aria-labelledby={`tab-${state.tab}`}>
              {state.tab === "heute" && (
                <HeuteTab items={state.items} log={state.log} onLog={handleLog}
                  pushError={pushError} prefs={state.prefs} priceMl={state.priceMl}
                  userNotePrefs={state.userNotePrefs} userFamilyPrefs={state.userFamilyPrefs}
                  onNavigate={id => dispatch({ type: 'SET_TAB', payload: id })}
                  onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }} />
              )}
              {state.tab === "sammlung" && (
                <SammlungTab items={state.items} log={state.log} notes={state.notes}
                  onDelete={handleDelete} onUpdate={handleUpdate}
                  onExport={handleExport} onSaveNote={handleSaveNote} onLog={handleLog}
                  fillLevels={state.fillLevels} onSetFill={handleSetFill}
                  priceMl={state.priceMl} onSavePriceMl={handleSavePriceMl} />
              )}
              {state.tab === "statistik" && (
                <StatistikTab items={state.items} log={state.log} notes={state.notes} onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }} />
              )}
              {state.tab === "ordner" && (
                <OrdnerTab items={state.items} onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }} />
              )}
              {state.tab === "layering" && (
                <LayeringTab items={state.items} />
              )}
              {state.tab === "declutter" && (
                <DeclutterTab items={state.items} log={state.log} onDelete={handleDelete} onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }} />
              )}
              {state.tab === "wunschliste" && (
                <WunschlisteTab wishlist={state.wishlist} onSave={saveWishlist}
                  items={state.items} onAddToCollection={handleAdd}
                  onSelectPerfume={id => { dispatch({ type: 'SET_DETAIL', payload: null }); dispatch({ type: 'SET_BACK_STACK', payload: s => [...s, state.tab].slice(-10) }); dispatch({ type: 'SET_DETAIL', payload: id }); }}
                  wishDetailsCache={state.wishDetailsCache} setWishDetailsCache={cache => dispatch({ type: 'SET_WISH_DETAILS_CACHE', payload: cache })}/>
              )}
              {state.tab === "settings" && (
                <EinstellungenTab items={state.items} onImport={handleImport} onExport={handleExport}
                  onAdd={handleAdd} onClearAll={() => saveItems([])} onClearAllData={handleClearAllData}
                  appName={state.prefs.appName} onSetAppName={handleSetAppName}
                  userNotePrefs={state.userNotePrefs} setUserNotePrefs={saveUserNotePrefs}
                  userFamilyPrefs={state.userFamilyPrefs} setUserFamilyPrefs={saveUserFamilyPrefs} />
              )}
            </main>
          </PullToRefresh>

          {/* App-level detail overlay: für Statistik, Heute, Ordner, Declutter, Wunschliste */}
          {appDetailPerfume && (
            <div ref={appDetailRef} style={{ position: "fixed", inset: 0, background: "#FAFAF8", zIndex: 9000, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", animation: "slideInRight .28s cubic-bezier(0.25,0.46,0.45,0.94) both", padding: 16, paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(56px + env(safe-area-inset-bottom))" }}>
              <DetailView perfume={appDetailPerfume} items={state.items} log={state.log} notes={state.notes}
                onClose={() => dispatch({ type: 'SET_DETAIL', payload: null })} onDelete={handleDelete}
                onUpdate={handleUpdate} onSaveNote={handleSaveNote} onLog={handleLog}
                onSearchNote={() => dispatch({ type: 'SET_DETAIL', payload: null })}
                fillLevels={state.fillLevels || {}} onSetFill={handleSetFill}
                priceMl={state.priceMl || {}} onSavePriceMl={handleSavePriceMl}
                containerRef={appDetailRef} />
            </div>
          )}
        </div>
      );
    }
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(React.createElement(AppErrorBoundary, null, React.createElement(App)));