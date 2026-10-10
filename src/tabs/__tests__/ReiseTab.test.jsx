/**
 * Komponenten-Tests für ReiseTab.jsx (Reise-/Set-Planer).
 *
 * Die Picker-Logik selbst ist in src/picker/__tests__/tripPlanner.test.js
 * abgedeckt; hier geht es um die UI: Rendering, Chip-Interaktion,
 * Ergebnis-Liste, "Anderer Vorschlag" und der KI-Flow
 * (groqClient wird gemockt – keine echten Netzwerk-Aufrufe).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ReiseTab from "../ReiseTab";

// groqClient mocken: useGroqCountdown liefert 0, groqFetch standardmäßig resolve
const groqFetchMock = vi.fn();

vi.mock("../../utils/groqClient", () => ({
  groqFetch: (...args) => groqFetchMock(...args),
  useGroqCountdown: () => 0,
}));

// Hilfs-Duft (Familien/Noten wie in den Logik-Tests)
function mk(id, family, notes) {
  return {
    id, name: `Duft ${id}`, family, families: [family],
    top: notes.top, middle: "", base: notes.base,
    season: "Ganzjährig", conc: "EDP", gender: "Unisex", format: "Flakon",
  };
}

const ITEMS = [
  mk("f1", "Fresh", { top: "Bergamotte, Zitrone", base: "Moschus" }),
  mk("o1", "Oriental", { top: "Safran", base: "Oud, Ambra" }),
];

const AI_OK = {
  days: 2,
  weathers: ["rainy", "cold"],
  occasions: ["evening", "date"],
  intensityPref: "strong",
  longevityPref: "long",
  reasoning: "Städtetrip mit Abenden: wärmere, präsentere Düfte.",
};

beforeEach(() => {
  groqFetchMock.mockReset();
  groqFetchMock.mockImplementation(async () => ({
    text: JSON.stringify(AI_OK),
    fromCache: false,
  }));
});

describe("ReiseTab", () => {
  it("rendert Kopf, KI-Karte und Tagesplan-Vorschau", () => {
    render(<ReiseTab items={ITEMS} />);
    expect(screen.getByText(/REISE-SET-PLANER/i)).toBeInTheDocument();
    expect(screen.getByText(/REISE MIT KI PLANEN/i)).toBeInTheDocument();
    // 3 Tage Default → 3 Tagesslots
    expect(screen.getByText("Tag 1")).toBeInTheDocument();
    expect(screen.getByText("Tag 3")).toBeInTheDocument();
    expect(screen.queryByText("Tag 4")).not.toBeInTheDocument();
  });

  it("zeigt nach dem Rendern die Ergebnis-Liste", () => {
    render(<ReiseTab items={ITEMS} />);
    expect(screen.getByText(/DEIN REISE-SET/i)).toBeInTheDocument();
    expect(screen.getByText("Duft f1")).toBeInTheDocument();
  });

  it("Reisedauer-Chips ändern die Tagesplan-Vorschau", () => {
    render(<ReiseTab items={ITEMS} />);
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect(screen.getByText("Tag 5")).toBeInTheDocument();
    expect(screen.queryByText("Tag 6")).not.toBeInTheDocument();
  });

  it("Wetter-Chips sind Mehrfachauswahl und spiegeln sich im Tagesplan", () => {
    render(<ReiseTab items={ITEMS} />);
    fireEvent.click(screen.getByRole("button", { name: /Kalt/i }));
    // Slot-Labels und der Chip selbst enthalten "Kalt"
    expect(screen.getAllByText(/Kalt/i).length).toBeGreaterThan(1);
  });

  it('"Anderer Vorschlag" entfernt den Top-Pick und zeigt den Reset-Button', async () => {
    render(<ReiseTab items={ITEMS} />);
    const buttons = screen.getAllByRole("button", { name: /Anderer Vorschlag/i });
    expect(buttons.length).toBeGreaterThan(0);
    const topName = screen.getAllByText(/^Duft /)[0].textContent;
    fireEvent.click(buttons[0]);
    await waitFor(() => {
      expect(screen.getByText(/Reset \(1\)/i)).toBeInTheDocument();
    });
    // Der abgelehnte Duft ist nicht mehr im Set
    expect(screen.queryByText(topName)).not.toBeInTheDocument();
  });

  it("leere Sammlung zeigt den Leerzustand", () => {
    render(<ReiseTab items={[]} />);
    expect(screen.getByText(/Keine Flakons im Set/i)).toBeInTheDocument();
  });

  it("KI-Flow: Beschreibung füllt Chips und zeigt die Begründung", async () => {
    render(<ReiseTab items={ITEMS} />);
    const ta = screen.getByLabelText("Reisebeschreibung für die KI");
    fireEvent.change(ta, { target: { value: "2 Tage Städtetrip, regen und Abende" } });
    fireEvent.click(screen.getByRole("button", { name: /Planen lassen/i }));

    await waitFor(() => {
      // Tage auf 2 geklemmt: Tag 3 verschwindet
      expect(screen.queryByText("Tag 3")).not.toBeInTheDocument();
      expect(screen.getByText("Tag 2")).toBeInTheDocument();
    });
    // KI-Begründung sichtbar
    expect(screen.getByText(/KI-Begründung:/i)).toBeInTheDocument();
    expect(screen.getByText(/Städtetrip mit Abenden/i)).toBeInTheDocument();
    // KI-Wetter "rainy" wurde übernommen → Regen im Tagesplan
    expect(screen.getAllByText(/Regen/i).length).toBeGreaterThan(0);
  });

  it("KI-Flow: ungültige KI-Werte werden verworfen (Sanitizing)", async () => {
    groqFetchMock.mockImplementation(async () => ({
      text: JSON.stringify({
        days: 99, weathers: ["beach", "rainy"], occasions: ["formal", "date"],
        intensityPref: "krass", longevityPref: "long", reasoning: "ok",
      }),
      fromCache: false,
    }));
    render(<ReiseTab items={ITEMS} />);
    fireEvent.change(screen.getByLabelText("Reisebeschreibung für die KI"),
      { target: { value: "irgendwas" } });
    fireEvent.click(screen.getByRole("button", { name: /Planen lassen/i }));

    await waitFor(() => {
      // days 99 → auf 7 geklemmt, Tag 7 sichtbar
      expect(screen.getByText("Tag 7")).toBeInTheDocument();
    });
    // "beach" verworfen, "rainy" übernommen → Regen sichtbar
    expect(screen.getAllByText(/Regen/i).length).toBeGreaterThan(0);
  });

  it("KI-Fehler wird als Meldung angezeigt", async () => {
    groqFetchMock.mockImplementation(async () => {
      throw new Error("KI-Antwort konnte nicht gelesen werden.");
    });
    render(<ReiseTab items={ITEMS} />);
    fireEvent.change(screen.getByLabelText("Reisebeschreibung für die KI"),
      { target: { value: "3 Tage Sommer" } });
    fireEvent.click(screen.getByRole("button", { name: /Planen lassen/i }));
    expect(await screen.findByText("KI-Antwort konnte nicht gelesen werden.")).toBeInTheDocument();
  });
});
