import { expect, test } from 'playwright/test'

test.use({ serviceWorkers: 'block' })

test('mobile WebKit survives an estimate with missing distance and recovers', async ({ context, page }) => {
  test.setTimeout(120_000)
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:3187' })
  await context.setGeolocation({ latitude: 5.518, longitude: 7.495 })
  await page.addInitScript(() => {
    sessionStorage.setItem('lx_splash', '1')
  })

  let validDistance = false
  await page.route('**/api/orders/estimate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        estimate: {
          ...(validDistance ? { distanceKm: 1.25 } : {}),
          serviceFeeKobo: 10_000,
          deliveryFeeKobo: 40_000,
          activeSurchargeTotalKobo: 0,
        },
      }),
    })
  })

  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.goto('/store/playwright-campus-kitchen')
  await expect(page.locator('.lx-splash')).toBeHidden({ timeout: 60_000 })
  await page.getByRole('button', { name: /Add Fixture Jollof Bowl/i }).click()
  const sheet = page.locator('.lx-sheet').last()
  await sheet.getByRole('radio', { name: /Regular bowl/i }).click()
  await sheet.getByRole('button', { name: /Add to cart/i }).click()
  await page.getByRole('button', { name: /View Cart/i }).click()
  await expect(page).toHaveURL(/\/cart/)
  await expect(page.getByText('Fixture Jollof Bowl')).toBeVisible()
  await page.getByRole('button', { name: 'Use current location' }).click()
  await expect(page.getByText(/Distance unavailable|Could not estimate delivery|outside the configured service area/i)).toBeVisible()
  expect(pageErrors).toEqual([])

  validDistance = true
  await page.getByRole('button', { name: 'Use current location' }).click()
  await expect(page.getByText('1.25 km')).toBeVisible()
  expect(pageErrors).toEqual([])
})
