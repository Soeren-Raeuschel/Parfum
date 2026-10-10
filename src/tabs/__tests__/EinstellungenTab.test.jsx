/**
 * EinstellungenTab.test.jsx – Smoke-Tests für die Einstellungen:
 * Alle Bereiche rendern, der Parfumo-URL-Flow ist dorthin verlagert
 * (dorthin gehört er nicht mehr – das Add-by-Link-Modal lebt in der Sammlung).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EinstellungenTab from "../EinstellungenTab";

const DEFAULT_PROPS = {
  items: [
    { id: "a1", name: "Aventus", house: "Creed", url: "https://www.parfumo.de/x" },
  ],
  onImport: vi.fn(),
  onExport: vi.fn(),
  onClearAll: vi.fn(),
  onClearAllData: vi.fn(),
  appName: "Sillage",
  onSetAppName: vi.fn(),
  userNotePrefs: [],
  setUserNotePrefs: vi.fn(),
  userFamilyPrefs: [],
  setUserFamilyPrefs: vi.fn(),
};

describe("EinstellungenTab", () => {
  it("rendert alle Hauptbereiche", () => {
    render(<EinstellungenTab {...DEFAULT_PROPS} />);
    expect(screen.getByText("Präferenzen")).toBeInTheDocument();
    expect(screen.getByText("API & Datenquellen")).toBeInTheDocument();
    expect(screen.getByText("Daten & Backup")).toBeInTheDocument();
    expect(screen.getByText("Gefahrenzone")).toBeInTheDocument();
  });

  it("Import/Export-Sektion öffnet und zeigt die Eintragszahl", async () => {
    const user = userEvent.setup();
    render(<EinstellungenTab {...DEFAULT_PROPS} />);
    // Disclosure-Panels sind geschlossen unmountet → Sektion erst öffnen
    await user.click(screen.getByText("Daten & Backup"));
    expect(screen.getByText(/IMPORTIEREN \(TSV \/ CSV \/ JSON\)/)).toBeInTheDocument();
    expect(screen.getByText(/TSV exportieren \(1 Einträge\)/)).toBeInTheDocument();
  });

  it("hat keinen Parfumo-URL-Input mehr ( verschoben in die Sammlung )", () => {
    render(<EinstellungenTab {...DEFAULT_PROPS} />);
    expect(screen.queryByLabelText("Parfumo URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Parfumo-URL eingeben → Daten werden automatisch extrahiert.")).not.toBeInTheDocument();
  });

  it("Gefahrenzone öffnet, Buttons vorhanden, Lösch-Dialog bleibt zunächst zu", async () => {
    const user = userEvent.setup();
    render(<EinstellungenTab {...DEFAULT_PROPS} />);
    await user.click(screen.getByText("Gefahrenzone"));
    expect(screen.getByText("Sammlung leeren")).toBeInTheDocument();
    expect(screen.getByText("Alle Daten zurücksetzen")).toBeInTheDocument();
    expect(screen.queryByText(/wirklich löschen/)).not.toBeInTheDocument();
  });
});
