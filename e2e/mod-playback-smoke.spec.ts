import { expect, test } from '@playwright/test';

test('Amiga MOD openmpt playback reaches playing state', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');

  await page.getByRole('combobox', { name: 'Platform' }).selectOption('amiga');
  await page.getByRole('combobox', { name: 'Search field' }).selectOption('title');
  await page.getByRole('searchbox', { name: 'Search music' }).fill('anarchy2');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const row = page.locator('.track-list li').filter({ hasText: 'anarchy2' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: /Play anarchy2/i }).click();

  const player = page.getByRole('contentinfo', { name: 'Player' });
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await expect(player.getByText('anarchy2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand player' }).click();

  await expect
    .poll(async () => {
      const seek = player.getByRole('slider', { name: 'Seek' });
      const value = Number(await seek.inputValue());
      return value > 0.05;
    }, { timeout: 12_000 })
    .toBe(true);
});
