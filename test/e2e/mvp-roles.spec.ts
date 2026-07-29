import { expect, test, type Page } from 'playwright/test'
import { authenticateAs } from './auth'

const fixtureItem = {
  id: 'fixture-line',
  menu_item_id: '22222222-2222-4222-8222-222222222222',
  name: 'Fixture Jollof Bowl',
  price_kobo: 250000,
  quantity: 1,
  image_url: '/icons/icon-512-v2.png',
  category: 'RICE',
  addons: [],
}

async function seedCart(page: Page, vendorId = '11111111-1111-4111-8111-111111111111', vendorName = 'Playwright Campus Kitchen') {
  await page.addInitScript(({ item, id, name }) => {
    localStorage.setItem('lumex_cart', JSON.stringify({ vendor_id: id, vendor_name: name, items: [item] }))
  }, { item: fixtureItem, id: vendorId, name: vendorName })
}

test('customer storefront, cart boundary, checkout, and maintenance payment gate', async ({ page }) => {
  await authenticateAs(page, 'customer')
  await page.goto('/home')
  await expect(page.getByRole('searchbox', { name: /Search restaurants/i })).toBeVisible()
  await page.getByText('Playwright Campus Kitchen').first().click()
  await expect(page).toHaveURL(/\/(?:store|vendor)\//)

  await page.evaluate(({ item }) => {
    localStorage.setItem('lumex_cart', JSON.stringify({
      vendor_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      vendor_name: 'Another Vendor',
      items: [item],
    }))
  }, { item: fixtureItem })
  await page.reload()
  await page.getByRole('button', { name: /Add Fixture Jollof Bowl/i }).click()
  const sheet = page.locator('.lx-sheet').last()
  await sheet.getByRole('radio', { name: /Regular bowl/i }).click()
  await page.getByRole('button', { name: /Add to cart/i }).click()
  await expect(page.getByText(/items from Another Vendor/i)).toBeVisible()
  await expect(page.getByText(/Starting a new cart will remove them/i)).toBeVisible()

  await seedCart(page)
  await page.goto('/cart')
  await expect(page.getByText('Fixture Jollof Bowl').first()).toBeVisible()
  const response = await page.request.post('/api/orders', {
    data: {
      vendor_id: '11111111-1111-4111-8111-111111111111',
      items: [{ menu_item_id: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
      delivery_type: 'BIKE',
      delivery_address: 'Fixture Hostel',
      delivery_latitude: 5.83,
      delivery_longitude: 7.39,
      payment_method: 'PAYSTACK',
    },
  })
  expect(response.status()).toBe(503)
})

test('guest checkout remains usable but guessed tracking tokens are denied', async ({ page }) => {
  await seedCart(page)
  await page.goto('/cart')
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible()
  await expect(page.getByLabel('WhatsApp phone')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Consent' })).toBeVisible()

  await page.goto('/order/LX-E2E-CURRENT?guest=not-a-valid-private-token')
  await expect(page).toHaveURL(/\/auth/)
  await expect(page.getByText('Fixture Hostel, Block B, Room 4')).toHaveCount(0)
})

test('vendor can use own menu and orders while another vendor resource is unavailable', async ({ page }) => {
  await authenticateAs(page, 'vendor')
  await page.goto('/vendor-dashboard/menu')
  await expect(page.getByRole('heading', { name: 'My Menu' })).toBeVisible()
  await expect(page.getByText(/Fixture Jollof Bowl/i).first()).toBeVisible()
  await page.getByRole('button', { name: /\+ Add food/i }).click()
  await page.getByLabel('Name').fill('Fixture Fried Rice')
  await page.getByLabel(/Price/).fill('1800')
  await page.getByRole('button', { name: 'Add to menu' }).click()
  await expect(page.getByRole('button', { name: 'Add to menu' })).toHaveCount(0)

  await page.goto('/vendor-dashboard/orders')
  await expect(page.getByText(/Orders|queue/i).first()).toBeVisible()

  const foreign = await page.request.patch('/api/vendor/menu/ffffffff-ffff-4fff-8fff-ffffffffffff', {
    data: { name: 'Tampered', price_naira: 1, category: 'RICE', addons: [] },
  })
  expect([403, 404]).toContain(foreign.status())
})

test('rider sees eligible work and handover UI but cannot mutate an unassigned delivery', async ({ page }) => {
  await authenticateAs(page, 'rider')
  await page.goto('/rider')
  await expect(page.getByRole('heading', { name: 'Rita Rider' })).toBeVisible()
  await expect(page.getByText('Available orders')).toBeVisible()
  await expect(page.getByLabel('6-character delivery code')).toBeVisible()

  const foreign = await page.request.patch('/api/orders/aaaaaaaa-0000-4000-8000-000000000005/status', {
    data: { status: 'PICKED_UP' },
  })
  expect(foreign.status()).toBe(403)
})

test('admin operations load, intervention is authorized, and super-admin APIs remain forbidden', async ({ page }) => {
  await authenticateAs(page, 'admin')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('Orders today')).toBeVisible()

  const intervention = await page.request.patch('/api/orders/aaaaaaaa-0000-4000-8000-000000000006/status', {
    data: { status: 'DELIVERED' },
  })
  expect(intervention.status()).toBe(200)

  const privileged = await page.request.get('/api/super-admin/settings')
  expect(privileged.status()).toBe(403)
  await page.goto('/super-admin')
  await expect(page).toHaveURL(/\/admin/)
})

test('malformed delivery estimates do not crash an iPhone-sized checkout or disclose stacks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedCart(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              latitude: 5.8301, longitude: 7.3958, accuracy: 5,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition)
        },
      },
    })
  })
  await page.route('**/api/orders/estimate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        estimate: {
          serviceFeeKobo: 10000,
          deliveryFeeKobo: 20000,
          activeSurchargeTotalKobo: 0,
        },
        stack: 'SECRET_INTERNAL_STACK',
      }),
    })
  })
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.goto('/cart')
  await page.getByRole('button', { name: 'Use current location' }).click()
  await expect(page.getByText('Could not estimate delivery right now.')).toBeVisible()
  expect(pageErrors).toEqual([])
  await expect(page.getByText('SECRET_INTERNAL_STACK')).toHaveCount(0)
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(horizontalOverflow).toBe(false)
})
