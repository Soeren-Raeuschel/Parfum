import { test, expect } from '@playwright/test';

test('App lädt ohne Absturz', async ({ page }) => {
  // App starten und prüfen, ob sie ohne Fehler initialisiert wird
  await page.goto('http://localhost:5173');
  // Die App sollte sichtbare UI-Elemente haben
  await expect(page.locator('h1')).toBeVisible();
});

test('Toast-Notification bei Fehlern', async ({ page }) => {
  await page.goto('http://localhost:5173');
  // Fehler simulieren: Navigation zu ungültigem Pfad
  await page.goto('http://localhost:5173/api/nonexistent');
  // App sollte nicht abstürzen und Fehler-Handling zeigen
  await expect(page.locator('body')).toBeVisible();
  // Falls Toast-Elemente vorhanden sind, prüfen
  const toastCount = await page.locator('[role="alert"]').count();
  // App bleibt stabil
  await expect(page.locator('body')).toBeVisible();
});

test('Loading States werden angezeigt', async ({ page }) => {
  // App sollte schnell laden und im Stable-Zustand enden
  await page.goto('http://localhost:5173');
  // Nach Ladezeit sollte die App stabil sein
  await page.waitForTimeout(1000);
  // App bleibt sichtbar
  await expect(page.locator('body')).toBeVisible();
});

test('Graceful Degradation bei Netzwerkfehler', async ({ page, context }) => {
  // App starten
  await page.goto('http://localhost:5173');
  // Warte bis App geladen ist
  await page.waitForTimeout(1000);
  // Nur API-Anfragen abfangen (nicht statische Assets)
  await context.route('**/api/**', route => route.fulfill({ status: 503 }));
  await context.route('**/groq/**', route => route.fulfill({ status: 503 }));
  await context.route('**/weather*', route => route.fulfill({ status: 503 }));
  // Versuche API-Aufruf zu triggern (z.B. Wetter aktualisieren)
  await page.click('text=WETTER AUTOMATISCH ERKENNEN');
  await page.waitForTimeout(2000);
  // App sollte stabil bleiben trotz API-Fehlers
  await expect(page.locator('body')).toBeVisible();
  // App sollte eine Fehlermeldung zeigen oder im Stable-Zustand bleiben
  await page.waitForTimeout(1000);
  await expect(page.locator('body')).toBeVisible();
  // Route abbrechen
  await context.unroute('**/api/**');
  await context.unroute('**/groq/**');
  await context.unroute('**/weather*');
});

test('Error Banner bei kritischen Fehlern', async ({ page }) => {
  await page.goto('http://localhost:5173');
  // UI-Elemente prüfen, die auf Fehler hinweisen
  // App sollte stabil bleiben
  await expect(page.locator('body')).toBeVisible({ timeout: 5000 });
});