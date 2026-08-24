import { expect, test } from '@playwright/test';

test('BEST shows single Arcade top with French staples then VGMRips', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('tab', { name: 'BEST', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'BEST', exact: true })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Arcade FR', exact: true })).toHaveCount(0);

  const arcadeColumn = page.getByRole('heading', { name: 'Arcade', exact: true });
  await expect(arcadeColumn).toBeVisible();

  const arcadeSection = page.locator('.top-games-column.source-arcade');
  await expect(arcadeSection).toContainText(/· 100/);
  await expect(
    arcadeSection.getByRole('button', { name: /Street Fighter II/i }).first(),
  ).toBeVisible();
  await expect(arcadeSection.getByRole('button', { name: /Golden Axe/i }).first()).toBeVisible();
  await expect(arcadeSection.getByRole('button', { name: /Pang/i }).first()).toBeVisible();
  await expect(arcadeSection.getByRole('button', { name: /Dragon Saber/i }).first()).toBeVisible();
});
