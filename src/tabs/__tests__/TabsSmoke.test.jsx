/**
 * TabsSmoke.test.jsx – Smoke-Tests für die bislang ungetesteten Tabs:
 * StatistikTab, OrdnerTab, WunschlisteTab, DeclutterTab und LayeringTab
 * rendern ohne Absturz mit leeren/gefüllten Daten.
 * Interaktive Logik (Charts, KI) wird hier bewusst nicht getestet –
 * dafür gibt es dedizierte Logik-Tests in src/picker bzw. src/utils.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StatistikTab from "../StatistikTab";
import OrdnerTab from "../OrdnerTab";
import WunschlisteTab from "../WunschlisteTab";
import DeclutterTab from "../DeclutterTab";
import LayeringTab from "../LayeringTab";

// Supabase nicht konfiguriert → keine Netzwerk-Pfade in den Modulen
vi.mock("../../lib/supabase", () => ({ isSupabaseConfigured: false }));

function mk(id, over = {}) {
  return {
    id, name: `Duft ${id}`, house: `Haus ${id}`, conc: "EDP", family: "Fresh",
    families: ["Fresh"], top: "Bergamotte", middle: "", base: "Moschus",
    season: "Winter", gender: "Unisex", format: "Flakon", ...over,
  };
}

const ITEMS = [mk("a1"), mk("a2", { format: "Probe" })];

describe("Smoke: verbleibende Tabs rendern ohne Fehler", () => {
  it("StatistikTab rendert mit Sammlung und Log", () => {
    render(<StatistikTab items={ITEMS} log={[]} onSelectPerfume={vi.fn()} />);
    expect(screen.getAllByText(/Statistik|Profil|Übersicht/i).length).toBeGreaterThan(0);
  });

  it("StatistikTab rendert mit leerer Sammlung", () => {
    render(<StatistikTab items={[]} log={[]} onSelectPerfume={vi.fn()} />);
    expect(screen.getAllByText(/Statistik|Profil|Übersicht|Keine/i).length).toBeGreaterThan(0);
  });

  it("OrdnerTab rendert Gruppen mit Einträgen", () => {
    render(<OrdnerTab items={ITEMS} onSelectPerfume={vi.fn()} />);
    expect(screen.getAllByText(/Ordner|Gruppen|Sammlung/i).length).toBeGreaterThan(0);
    // Smoke: Gruppen werden gerendert (Inhalt hängt vom Gruppierungsschema ab)
    expect(document.body.textContent.length).toBeGreaterThan(100);
  });

  it("OrdnerTab zeigt den Leerzustand bei leerer Sammlung", () => {
    render(<OrdnerTab items={[]} onSelectPerfume={vi.fn()} />);
    expect(screen.getAllByText(/Ordner|Gruppen|Sammlung|Keine/i).length).toBeGreaterThan(0);
  });

  it("WunschlisteTab zeigt den Leerzustand", () => {
    render(<WunschlisteTab wishlist={[]} onSave={vi.fn()} items={ITEMS}
      onAddToCollection={vi.fn()} wishDetailsCache={{}} setWishDetailsCache={vi.fn()} />);
    expect(screen.getAllByText(/Wunsch|wunsch|Hinzufügen/i).length).toBeGreaterThan(0);
  });

  it("WunschlisteTab zeigt vorhandene Wünsche", () => {
    render(<WunschlisteTab
      wishlist={[{ id: "w1", name: "Wunschduft", house: "Haus X", prio: 2 }]}
      onSave={vi.fn()} items={ITEMS} onAddToCollection={vi.fn()}
      wishDetailsCache={{}} setWishDetailsCache={vi.fn()} />);
    expect(screen.getByText("Wunschduft")).toBeInTheDocument();
  });

  it("DeclutterTab rendert mit Sammlung", () => {
    render(<DeclutterTab items={ITEMS} log={[]} onDelete={vi.fn()}
      onSelectPerfume={vi.fn()} declutterStatus={{}} onSaveDeclutterStatus={vi.fn()} />);
    expect(screen.getAllByText(/Declutter|Aussortieren|Behalten/i).length).toBeGreaterThan(0);
  });

  it("LayeringTab rendert die Analyse-Ansicht", () => {
    render(<LayeringTab items={ITEMS} />);
    expect(screen.getAllByText(/Layering|Kombination|Analyse/i).length).toBeGreaterThan(0);
  });
});
