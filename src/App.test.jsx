import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App.jsx'

vi.mock('./data/storage', () => ({
  storage: {
    loadAll: vi.fn(async () => ({
      items: [],
      log: [],
      notes: {},
      wishlist: [],
      wishDetailsCache: {},
      prefs: { appName: 'Sillage' },
      userNotePrefs: [],
      userFamilyPrefs: [],
      fillLevels: {},
      priceMl: {},
      declutterStatus: {},
    })),
    saveItems: vi.fn(async () => undefined),
    saveLog: vi.fn(async () => undefined),
    saveNotes: vi.fn(async () => undefined),
    saveWishlist: vi.fn(async () => undefined),
    saveSettings: vi.fn(async () => undefined),
    saveFillLevels: vi.fn(async () => undefined),
    savePriceMl: vi.fn(async () => undefined),
    saveDeclutterStatus: vi.fn(async () => undefined),
  },
}))

describe('App', () => {
  it('rendert ohne Fehler', async () => {
    render(<App />)

    expect(await screen.findByRole('tablist', { name: 'Hauptnavigation' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /heute/i })).toHaveAttribute('aria-selected', 'true')
  })
})
