import { expect, test } from '@playwright/test';

test.describe('Library result density', () => {
  test('shows at least 10 result rows in the list viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Platform' }).selectOption('atari');
    await page.getByRole('searchbox', { name: 'Search music' }).fill('1989');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    await expect(page.locator('.track-list li').first()).toBeVisible({ timeout: 15_000 });

    const visibleCount = await page.locator('.track-list').evaluate((list) => {
      const listRect = list.getBoundingClientRect();
      return Array.from(list.querySelectorAll('li')).filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= listRect.top - 1 && rect.bottom <= listRect.bottom + 1;
      }).length;
    });

    expect(visibleCount).toBeGreaterThanOrEqual(10);
  });
});
