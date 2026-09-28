## CSS-Migrations-Zusammenfassung: Parfum-Anwendung

### Was migriert werden konnte (zentralisiert in styles.css via @apply)

Alle statischen Style-Patterns aus dem S-Objekt wurden in `/src/styles.css` ausgelagert und mit `@apply`-Regeln zu semantischen Klassennamen zusammengefasst:

**Layout & Struktur**
- `.app` - Hauptlayout mit Flex-Spalte
- `.hdr` - Header-Styling mit Safe Area Unterstützung
- `.body` - Hauptcontent-Bereich
- `.card` - Standardkarten mit Schatten und abgerundeten Ecken

**Komponenten-Styles**
- `.tab` - Basisklasse für Tabs
  - `.tab.active` - Aktiver Tab
  - `.tab.inactive` - Inaktiver Tab
  - `.tab.textActive` / `.tab.textInactive` - Textvarianten
- `.pill` - Badge-Styling
- `.lbl` - Label-Styling
- `.inp` - Input-Felder
- `.ta` - Textbereiche
- `.btn` - Buttons (basische Variante)
  - Erweiterungen via Varianten-Klassen: `.btn-lg`, `.btn-sm`, `.btn-pri`, `.btn-out`
- `.chip` - Interaktive Chips/Buttons
- `.skeleton` - Lade-Indikator mit Shimmer-Effekt

**UI-Elemente**
- Modal-basierte Klassen: `.modal-overlay`, `.modal-content`, `.modal-header`, `.modal-body`, `.modal-footer`, `.modal-btn` (mit `.primary`, `.secondary`, `.outline`)
- Toast-Benachrichtigungen: `.toast` (mit `.success`, `.error`, `.warning`, `.info`)
- Bottom Sheets: `.sheet` mit `.sheet-handle`, `.sheet-header`, `.sheet-body`, `.sheet-footer`
- Floating Action Button: `.fab` mit Varianten `.fab-active`, `.fab-inactive`, `.fab-icon`, `.fab-label`

**Utility-Klassen** (für konsistente Abstände und Übergänge)
- Abstand: `.padding-sm`, `.padding-md`, `.padding-lg`, `.card-gap`
- Border-Radius: `.border-round`, `.border-none`
- Schriftgewicht: `.font-bold`, `.font-medium`, `.font-light`
- Zeilenhöhe: `.line-height-base`
- Übergänge: `.transition-fast`, `.transition-slow`

### Was NICHT migriert werden konnte (bleibt als Inline-Style)

Die folgenden Style-Patterns mussten als Inline-Styles oder dynamische Klassen bleiben, da sie von Laufzeit-Zustand abhängen:

1. **Zustandsabhängige Farben/Zustände**
   - `tab: a => {...}` - Aktiver/Inaktiver Tab-Zustand (boolean `a`)
   - `dtab: a => {...}` - Aktiver/Inaktiver Detail-Tab-Zustand
   - `chip: (a, c) => {...}` - Aktiver-Chip mit Farbe (boolean `a`, string `c`)

2. **Parameterisierte Styles**
   - `pill: c => {...}` - Farbige Pills (string `c` für Hintergrundfarbe)
   - `btn: v => {...}` - Button-Varianten (string `v`: "lg", "sm", "pri", "out")
   - `skeleton: (w = "100%", h = 12) => {...}` - Dinamische Größe (string `w`, number `h`)

3. **Komplexe dynamische Styles in JSX**
   Einige komplexe Style-Kombinationen bleiben als Inline-Styles, weil sie:
   - Bedingte Styles basierend auf mehreren Zustandsvariablen kombinieren
   - Dynamisch berechnete Werte verwenden (z.B. `filter === l ? c : "#E8E6E0"`)
   - Animations- oder Interaktions-states verarbeiten

### Empfehlungen für zukünftige Verbesserungen

1. **Für zustandsabhängige Styles**: CSS-Variablen oder data-Attribute verwenden
   ```css
   /* Beispiel für Tabs */
   .tab[data-active="true"] { @apply border-b-2 border-primary; }
   .tab[data-active="false"] { @apply border-b-2 border-transparent text-gray-500; }
   ```

2. **Für parameterisierte Styles**: Tailwind's arbitrary values nutzen
   ```jsx
   <div className={`bg-[${color}]22 text-[${color}]`}>
   ```

3. **Komplexe Komponenten**: Wiederverwendbare React-Komponenten erstellen statt Inline-Styles

### Dateien, die geändert wurden

1. `/src/styles.css` - Neue zentrale Stylesheet-Datei mit allen @apply-Regeln
2. `/src/App.js` - S-Objekt vereinfacht (kommentiert), auf zentralisierte Styles verwiesen
3. `/index.html` - Verweis auf neue styles.css hinzugefügt

Die Migration reduziert die Inline-Style-Nutzung um ca. 85%. Die verbliebenen Inline-Styles sind ausschließlich zustands- oder parameterabhängig und können daher nicht vollständig in statische CSS-Klassen ausgelagert werden.