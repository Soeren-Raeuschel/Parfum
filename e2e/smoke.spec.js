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
