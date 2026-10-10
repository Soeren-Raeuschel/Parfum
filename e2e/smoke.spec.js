import { test, expect } from '@playwright/test'
import { collectPageErrors } from './helpers.js'

async function prepareEmptyApp(page) {
  await page.addInitScript(() => {
    localStorage.setItem('parfum_onboard_v1', JSON.stringify({ done: true, data: null }))
  })
}

test('App lädt ohne Fehler', async ({ page }) => {
  await prepareEmptyApp(page)
  const errors = collectPageErrors(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('body')).not.toBeEmpty()
  await expect(page.locator('#root')).not.toBeEmpty()
  expect(errors.consoleErrors).toEqual([])
  expect(errors.pageErrors).toEqual([])
})

test('Keine 4xx/5xx für eigene Ressourcen', async ({ page }) => {
  await prepareEmptyApp(page)
  const failedResponses = []
  page.on('response', response => {
    if (response.url().startsWith('http://localhost:5173') && response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`)
    }
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#root')).not.toBeEmpty()
  expect(failedResponses).toEqual([])
})

test('Alle Routen sind erreichbar', async () => {
  test.skip(true, 'Die App verwendet keine URL-Routen, sondern interne Tabs.')
})

test('Haupt-Interaktion funktioniert', async ({ page }) => {
  await prepareEmptyApp(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const collectionTab = page.getByRole('tab', { name: /sammlung/i })
  await collectionTab.click()
  await expect(collectionTab).toHaveAttribute('aria-selected', 'true')

  await expect(page.getByText(/Keine Parfüms gefunden/)).toBeVisible()
})

test('Alle Tabs lassen sich ohne Fehler durchklicken', async ({ page }) => {
  await prepareEmptyApp(page)
  const errors = collectPageErrors(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const tabNames = ['HEUTE', 'SAMMLUNG', 'STATISTIK', 'ORDNER', 'LAYERING', 'VERGESSEN', 'WÜNSCHE', 'SETTINGS']
  for (const name of tabNames) {
    const tab = page.getByRole('tab', { name })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }

  expect(errors.consoleErrors).toEqual([])
  expect(errors.pageErrors).toEqual([])
})

// ── Mobile Bottom-Navigation (< 768px) ───────────────────────────────────────
// 4 Haupt-Tabs + "MEHR"-Button; Sekundär-Tabs nur über das Bottom-Sheet erreichbar.
test('Mobile: Bottom-Navigation sichtbar, obere Tab-Leiste ausgeblendet', async ({ page }) => {
  await prepareEmptyApp(page)
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 390, height: 844 }) // iPhone-Viewport
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const bottomnav = page.locator('.bottomnav')
  await expect(bottomnav).toBeVisible()
  // 4 Haupt-Tabs + 1 MEHR-Button
  await expect(bottomnav.locator('.btab')).toHaveCount(5)
  // Top-Tabs per CSS versteckt, aber im DOM vorhanden
  await expect(page.locator('.tabs')).toBeHidden()

  // Haupt-Tabs durchklicken und Aktiv-Zustand prüfen
  for (const name of ['HEUTE', 'SAMMLUNG', 'REISE', 'WÜNSCHE']) {
    const btn = bottomnav.locator('.btab', { hasText: name })
    await btn.click()
    await expect(btn).toHaveClass(/active/)
  }

  // "Mehr"-Sheet: öffnen, jeden Sekundär-Tab anwählen, wieder öffnen
  const sheet = page.locator('.moresheet')
  for (const name of ['STATISTIK', 'ORDNER', 'LAYERING', 'VERGESSEN', 'SETTINGS']) {
    await bottomnav.locator('.btab', { hasText: 'MEHR' }).click()
    await expect(sheet).toBeVisible()
    await sheet.locator('.moreitem', { hasText: name }).click()
    // Auswahl schließt das Sheet
    await expect(page.locator('.moresheet-overlay')).toBeHidden()
  }

  // Overlay-Klick außerhalb schließt das Sheet
  await bottomnav.locator('.btab', { hasText: 'MEHR' }).click()
  await expect(sheet).toBeVisible()
  await page.locator('.moresheet-overlay').click({ position: { x: 10, y: 10 } })
  await expect(page.locator('.moresheet-overlay')).toBeHidden()

  expect(errors.consoleErrors).toEqual([])
  expect(errors.pageErrors).toEqual([])
})

// ── Desktop (>= 768px) ───────────────────────────────────────────────────────
// Obere Navigation bleibt, Bottom-Bar und Sheet werden nie angezeigt.
test('Desktop: Bottom-Navigation ausgeblendet, obere Tab-Leiste sichtbar', async ({ page }) => {
  await prepareEmptyApp(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('.tabs')).toBeVisible()
  await expect(page.locator('.bottomnav')).toBeHidden()
  await expect(page.locator('.moresheet-overlay')).toHaveCount(0)
})

