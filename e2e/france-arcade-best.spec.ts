import { expect, test } from '@playwright/test';

test('BEST shows Arcade FR diffusions column with Street Fighter II', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('tab', { name: 'BEST', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'BEST', exact: true })).toBeVisible();

  const frColumn = page.getByRole('heading', { name: 'Arcade FR', exact: true });
  await expect(frColumn).toBeVisible();

  const frSection = page.locator('.top-games-column.source-arcade-fr');
  await expect(
    frSection.getByRole('button', { name: /Street Fighter II/i }).first(),
  ).toBeVisible();
  await expect(frSection.getByRole('button', { name: /Golden Axe/i }).first()).toBeVisible();
  await expect(frSection.getByRole('button', { name: /Pang/i }).first()).toBeVisible();
});
