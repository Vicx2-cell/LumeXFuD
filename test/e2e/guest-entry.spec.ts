import { expect, test } from 'playwright/test'

test('a visitor can browse restaurants before creating an account', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Browse restaurants' }).click()

  await expect(page).toHaveURL(/\/home/)
  await expect(page.getByRole('heading', { name: /What are you eating today/i })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
})
