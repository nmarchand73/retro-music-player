import { expect, test } from '@playwright/test';

test('Bookmarks can be reordered with move controls', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await fetch('/api/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookmarks: [] }),
    });
    localStorage.setItem('retro-music-player.bookmarks', '[]');
  });
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Bookmarks', exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('combobox', { name: 'Platform' }).selectOption('atari');
  await page.getByRole('searchbox', { name: 'Search music' }).fill('Last Ninja');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const lastNinja = page
    .locator('.track-list li')
    .filter({ has: page.getByRole('button', { name: /^Play Last Ninja,/ }) })
    .first();
  await expect(lastNinja).toBeVisible({ timeout: 20_000 });
  await lastNinja.getByRole('button', { name: 'Bookmark Last Ninja', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Bookmarks (1)' })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search music' }).fill('Wings of Death STFM');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const wings = page
    .locator('.track-list li')
    .filter({ has: page.getByRole('button', { name: /^Play Wings of Death STFM,/ }) })
    .first();
  await expect(wings).toBeVisible({ timeout: 20_000 });
  await wings.getByRole('button', { name: 'Bookmark Wings of Death STFM', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Bookmarks (2)' })).toBeVisible();

  await page.getByRole('tab', { name: 'Bookmarks (2)' }).click();
  await expect(page.getByRole('heading', { name: 'Bookmarks' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Sort' }).selectOption('match');

  const list = page.locator('.track-list li');
  await expect(list).toHaveCount(2);

  await expect(list.nth(0)).toContainText(/Wings of Death STFM/i);
  await expect(list.nth(1)).toContainText(/^[\s\S]*Last Ninja(?! 2| 3| -)/);

  await list.nth(0).getByRole('button', { name: 'Move Wings of Death STFM down' }).click();

  await expect(list.nth(0)).toContainText(/Last Ninja/i);
  await expect(list.nth(1)).toContainText(/Wings of Death STFM/i);

  await page.reload();
  await page.getByRole('tab', { name: /Bookmarks/ }).click();
  await page.getByRole('combobox', { name: 'Sort' }).selectOption('match');
  const afterReload = page.locator('.track-list li');
  await expect(afterReload.nth(0)).toContainText(/Last Ninja/i);
  await expect(afterReload.nth(1)).toContainText(/Wings of Death STFM/i);
});
