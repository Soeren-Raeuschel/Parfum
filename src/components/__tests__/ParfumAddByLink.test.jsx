/**
 * ParfumAddByLink.test.jsx – Tests für das „Parfüm per Parfumo-URL hinzufügen"-Modal:
 * Fehlerbehandlung bei ungültigen URLs, Lookup-Flow mit gemocktem ladeParfumdaten
 * und das onAdd/Celebration-Verhalten beim Bestätigen.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ParfumAddByLink from "../ParfumAddByLink";

// Lookup-Kette mocken (kein echtes Netzwerk / keine KI-Aufrufe)
vi.mock("../../utils/parfumoLookup", () => ({
  ladeParfumdaten: vi.fn(async () => ({
    name: "Aventus", house: "Creed", conc: "EDP", family: "Fruchtig",
    top: "Bergamotte", middle: "Birke", base: "Moschus", season: "Winter",
  })),
}));

// EvolveCard mocken: nur prüfen, OB sie nach dem Hinzufügen erscheint
vi.mock("../EvolveCard", () => ({ default: () => <div data-testid="evolve-card" /> }));

import { ladeParfumdaten } from "../../utils/parfumoLookup";

const ITEMS = [
  { id: "a1", name: "Aventus", house: "Creed", url: "https://www.parfumo.de/Parfums/Creed/Aventus" },
];

function renderModal() {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<ParfumAddByLink open items={ITEMS} onAdd={onAdd} onClose={onClose} />);
  return { onAdd, onClose };
}

describe("ParfumAddByLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("zeigt einen Fehler bei nicht-parfumo.de-URLs, ohne Lookup zu starten", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText("Parfumo URL"), "https://example.com/x");
    await user.click(screen.getByRole("button", { name: "Laden" }));
    expect(await screen.findByText(/Nur parfumo.de-Links/)).toBeInTheDocument();
    expect(ladeParfumdaten).not.toHaveBeenCalled();
  });

  it("lädt Daten per Lookup und zeigt die bearbeitbare Vorschau", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText("Parfumo URL"), "https://www.parfumo.de/Parfums/Creed/Aventus");
    await user.click(screen.getByRole("button", { name: "Laden" }));
    // extrahiereBrandName zerlegt die URL → ladeParfumdaten("Creed", "Aventus")
    await waitFor(() => expect(ladeParfumdaten).toHaveBeenCalledWith("Creed", "Aventus"));
    expect(await screen.findByText("Vorschau")).toBeInTheDocument();
    // Mock-Daten sollen im Vorschaufeld vorausgefüllt sein
    expect(screen.getByDisplayValue("Aventus")).toBeInTheDocument();
  });

  it("warnt, wenn die URL bereits in der Sammlung ist", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText("Parfumo URL"), "https://www.parfumo.de/Parfums/Creed/Aventus");
    await user.click(screen.getByRole("button", { name: "Laden" }));
    expect(await screen.findByText(/bereits in deiner Sammlung/)).toBeInTheDocument();
  });

  it("ruft onAdd mit dem gewählten Format auf und zeigt die Celebration-Card", async () => {
    const user = userEvent.setup();
    const { onAdd, onClose } = renderModal();
    await user.type(screen.getByLabelText("Parfumo URL"), "https://www.parfumo.de/Parfums/Creed/Aventus");
    await user.click(screen.getByRole("button", { name: "Laden" }));
    await screen.findByText("Vorschau");
    // Format auf „Flakon“ umschalten, dann hinzufügen
    await user.click(screen.getByRole("button", { name: "Flakon" }));
    await user.click(screen.getByRole("button", { name: /Hinzufügen als Flakon/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: "Aventus", house: "Creed", format: "Flakon" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("evolve-card")).toBeInTheDocument();
  });

  it("bricht ab, wenn im Vorschau-Namensfeld kein Name steht", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderModal();
    await user.type(screen.getByLabelText("Parfumo URL"), "https://www.parfumo.de/Parfums/Creed/Aventus");
    await user.click(screen.getByRole("button", { name: "Laden" }));
    await screen.findByText("Vorschau");
    // Namen leeren → Bestätigen ohne Name blockiert
    const nameInput = screen.getByPlaceholderText("Name *");
    await user.clear(nameInput);
    await user.click(screen.getByRole("button", { name: /^Hinzufügen als/ }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText("Name fehlt.")).toBeInTheDocument();
  });
});

