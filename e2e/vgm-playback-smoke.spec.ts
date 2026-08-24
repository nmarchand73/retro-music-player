import { expect, test } from '@playwright/test';

test('Arcade VGM playback advances position (Out Run)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');

  await page.getByRole('combobox', { name: 'Platform' }).selectOption('arcade');
  await page.getByRole('searchbox', { name: 'Search music' }).fill('Out Run');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const row = page
    .locator('.track-list li')
    .filter({ has: page.locator('[data-platform="arcade"]') })
    .filter({ hasText: /Magical Sound Shower|Splash Wave|Out Run/i })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /Play/i }).first().click();

  const player = page.getByRole('contentinfo', { name: 'Player' });
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 90_000 });

  const countdown = player.locator('.player-title-duration');
  await expect(countdown).toBeVisible();
  const initial = await countdown.textContent();
  expect(initial).toMatch(/^\d+:\d{2}$/);

  await expect
    .poll(async () => {
      const next = await countdown.textContent();
      return next !== initial;
    }, { timeout: 15_000 })
    .toBe(true);

  await page.getByRole('button', { name: 'Expand player' }).click();

  await expect
    .poll(async () => {
      const seek = player.getByRole('slider', { name: 'Seek' });
      const value = Number(await seek.inputValue());
      return value > 0.3;
    }, { timeout: 20_000 })
    .toBe(true);
});
