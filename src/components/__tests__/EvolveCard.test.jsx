/**
 * EvolveCard.test.jsx – Direktest der CELEBRATION-Karte.
 *
 * Wichtig: Andere Tests mocken EvolveCard als Stub (vi.mock) – damit wäre ein
 * Crash im Render-Körper unsichtbar (so geschah es beim TDZ-Bug
 * "Cannot access 'i' before initialization"). Dieser Test rendert die ECHTE
 * Komponente, damit jeder Render-/Laufzeitfehler sofort auffällt.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import EvolveCard from "../EvolveCard";

const DUMMY_PERFUME = {
  id: "p1",
  name: "Test-Duft",
  house: "Test-Haus",
  family: "Hölzig",
  families: ["Hölzig", "Würzig"],
  top: "Bergamotte, Pfeffer",
  middle: "Zedernholz",
  base: "Moschus, Vetiver",
  format: "Flakon",
  year: "2024",
};

describe("EvolveCard (echtes Rendern, kein Stub)", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.removeItem("parfum_anim_debug");
  });

  it("rendert ohne Crash und zeigt Name, Haus und Noten", () => {
    render(<EvolveCard perfume={DUMMY_PERFUME} onClose={() => {}} />);

    // Karte ist sichtbar mit den Kern-Daten
    expect(screen.getByText("Test-Duft")).toBeInTheDocument();
    expect(screen.getByText("Test-Haus")).toBeInTheDocument();
    expect(screen.getByText(/Bergamotte, Pfeffer/)).toBeInTheDocument();
    expect(screen.getByText(/Moschus, Vetiver/)).toBeInTheDocument();
    expect(screen.getByText(/ZUR SAMMLUNG HINZUGEFÜGT/i)).toBeInTheDocument();
  });

  it("schließt von selbst (Auto-Close ruft onClose auf)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<EvolveCard perfume={DUMMY_PERFUME} onClose={onClose} />);

    // SPIN_MS(1400) + HOLD_MS(2200) + FADE_MS(400) + etwas Puffer
    vi.advanceTimersByTime(4100);
    expect(onClose).toHaveBeenCalled();
  });

  it("zeigt ohne Parfum nichts an", () => {
    const { container } = render(<EvolveCard perfume={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("überlebt fehlende optionale Felder (kein Crash bei undefined family/notes)", () => {
    render(<EvolveCard perfume={{ id: "p2", name: "Minimal" }} onClose={() => {}} />);
    expect(screen.getByText("Minimal")).toBeInTheDocument();
  });
});
