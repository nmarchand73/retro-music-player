import { expect, test } from '@playwright/test';

test.describe('Library insights golden path', () => {
  test('open Insights, browse top composers and jump into a library search', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: /Atari · Amiga · CPC · C64/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Insights' })).toBeVisible();

    await page.getByRole('tab', { name: 'Insights' }).click();
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
    await expect(page.getByText('Crunching the archive…').or(page.getByRole('heading', { name: 'Top composers' }))).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Top composers' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Richest soundtracks' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Formats' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Longest known' })).toBeVisible();

    await expect(page.getByLabel('Library overview')).toContainText(/Tracks/i);
    await expect(page.getByLabel('Top composers').locator('.insight-rank-row').first()).toBeVisible();

    const firstComposer = page.getByLabel('Top composers').locator('.insight-rank-row').first();
    const composerName = (await firstComposer.locator('.insight-rank-label').innerText()).trim();
    expect(composerName.length).toBeGreaterThan(1);

    await firstComposer.click();
    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveValue('author');
    await expect(page.getByRole('searchbox', { name: 'Search music' })).toHaveValue(composerName);

    await page.getByRole('tab', { name: 'Insights' }).click();
    await expect(page.getByRole('heading', { name: 'Richest soundtracks' })).toBeVisible();
    const firstGame = page.getByLabel('Top games by track count').locator('.insight-rank-row').first();
    const gameLabel = (await firstGame.locator('.insight-rank-label').innerText()).trim();
    await firstGame.click();
    await expect(page.getByRole('heading', { name: 'Library Results' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveValue('game');
    await expect(page.getByRole('searchbox', { name: 'Search music' })).toHaveValue(gameLabel);
  });
});
