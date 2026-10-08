import { splitNotes } from "../utils/helpers";
import { stripDiacritics } from "../utils/perfumeMatch";

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

export { LAYERING_COMPAT, getLayerCompat, analyzeNoteCompat, normNote, notesMatch };
