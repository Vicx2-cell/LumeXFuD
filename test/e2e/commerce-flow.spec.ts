import { expect, test } from 'playwright/test'

const viewports = [
  { width: 320, height: 700, label: '320x700' },
  { width: 360, height: 800, label: '360x800' },
  { width: 390, height: 844, label: '390x844' },
  { width: 412, height: 915, label: '412x915' },
  { width: 768, height: 1024, label: '768x1024' },
  { width: 1280, height: 900, label: 'desktop' },
]

test.describe('commerce storefront browser flow', () => {
  for (const viewport of viewports) {
    test(`storefront product sheet and cart at ${viewport.label}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/store/playwright-campus-kitchen')

      await expect(page).toHaveURL(/\/store\/playwright-campus-kitchen/)
      await expect(page.getByRole('heading', { name: /Playwright Campus Kitchen/i }).first()).toBeVisible()
      await expect(page.getByText(/Fixture Jollof Bowl/i).first()).toBeVisible()

      const addProduct = page.getByRole('button', { name: /Add Fixture Jollof Bowl/i })
      await expect(addProduct).toBeEnabled()
      await addProduct.click()
      const sheet = page.locator('.lx-sheet').last()
      await expect(sheet.getByRole('heading', { name: /Fixture Jollof Bowl/i })).toBeVisible()

      await sheet.getByRole('radio', { name: /Regular bowl/i }).click()
      await sheet.getByRole('button', { name: /Extra crunchy plantain with a long family-size name/i }).click()
      await page.getByLabel('Item note').fill('No onions, test note')
      const addToCart = page.getByRole('button', { name: /Add to cart/i })
      await expect(addToCart).toBeEnabled()
      await addToCart.click()
      await expect(page.getByRole('button', { name: /View Cart/i })).toBeVisible()

      await page.getByRole('button', { name: /View Cart/i }).click()
      await expect(page).toHaveURL(/\/cart/)
      await expect(page.getByText(/Playwright Campus Kitchen/i)).toBeVisible()
      await expect(page.getByText(/Fixture Jollof Bowl/i)).toBeVisible()
      await expect(page.getByText(/Extra crunchy plantain/i)).toBeVisible()

      const note = page.getByLabel(/Item note/i).first()
      await expect(note).toHaveValue('No onions, test note')
      await note.fill('Edited cart note')
      await expect(note).toHaveValue('Edited cart note')

      const checkout = page.getByRole('button', { name: /Pay|Checkout|Processing/i }).last()
      await expect(checkout).toBeDisabled()
      await expect(page.getByText(/Privacy Policy/i)).toBeVisible()

      await page.getByRole('button', { name: /Remove/i }).click()
      await expect(page.getByRole('heading', { name: /Your cart is feeling light/i })).toBeVisible()
      await page.getByRole('button', { name: /Undo remove/i }).click()
      await expect(page.getByText(/Fixture Jollof Bowl/i)).toBeVisible()

      const guestName = page.getByLabel('Name', { exact: true })
      const guestPhone = page.getByLabel('WhatsApp phone')
      await expect(guestName).toBeVisible()
      await guestName.fill('Ada Test')
      await guestPhone.fill('+2348012345678')
      const terms = page.getByRole('checkbox', { name: /I agree to the Terms/i })
      await expect(terms).not.toBeChecked()
      await expect(page.getByRole('button', { name: /^Pay /i })).toBeDisabled()
      await page.screenshot({ path: testInfo.outputPath(`guest-terms-${viewport.label}.png`), fullPage: true })
    })
  }
})
