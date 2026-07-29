import { expect, test } from 'playwright/test'

test('a visitor can browse restaurants before creating an account', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Browse restaurants' }).click()

  await expect(page).toHaveURL(/\/home/)
  await expect(page.getByRole('searchbox', { name: /Search restaurants/i })).toBeVisible()
  await expect(page.getByText('Playwright Campus Kitchen').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
})
