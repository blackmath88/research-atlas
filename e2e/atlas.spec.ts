import { expect, test, type Page } from '@playwright/test';

const FIXTURE = './?data=./fixtures/collections.json';

function trackOpenAlex(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('api.openalex.org')) hits.push(r.url());
  });
  return hits;
}

async function searchAndPick(page: Page, text: string, label: RegExp | string) {
  const box = page.getByRole('combobox', { name: /search people, works, topics/i });
  await box.fill(text);
  await page.getByRole('option', { name: label }).first().click();
}

test('loads the fixture and shows the synthetic banner', async ({ page }) => {
  const hits = trackOpenAlex(page);
  await page.goto(FIXTURE);
  await expect(page.getByTestId('synthetic-banner')).toContainText(
    'SYNTHETIC FIXTURE — invented test records, not real research data.',
  );
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
  expect(hits).toEqual([]);
});

test('search → person → work → source link', async ({ page }) => {
  const hits = trackOpenAlex(page);
  await page.goto(FIXTURE);
  await searchAndPick(page, 'Person O', /Test Person O/);
  const panel = page.getByTestId('panel');
  await expect(panel.getByRole('heading', { name: 'Test Person O' })).toBeVisible();
  await expect(page).toHaveURL(/sel=SYNA15/);
  await panel.getByRole('button', { name: 'Synthetic work 2: placeholder title for testing' }).click();
  await expect(panel.getByRole('heading', { name: 'Synthetic work 2: placeholder title for testing' })).toBeVisible();
  const src = panel.getByRole('link', { name: /record/ }).first();
  await expect(src).toHaveAttribute('href', /^https?:\/\//);
  await expect(src).toHaveAttribute('target', '_blank');
  expect(hits).toEqual([]);
});

test('"Why this connection?" shows shared reference evidence', async ({ page }) => {
  await page.goto(`${FIXTURE}&sel=SYNA15`);
  const panel = page.getByTestId('panel');
  await panel.getByRole('button', { name: 'Why this connection?' }).first().click();
  const conn = page.getByTestId('connection-panel');
  await expect(conn).toBeVisible();
  await expect(conn).toContainText('No shared publication found in this snapshot');
  const refs = conn.getByTestId('shared-references').first();
  await expect(refs).toContainText(/SYNR\d+|SYNW\d+/); // synthetic refs carry IDs but no fabricated links
  await expect(conn).toContainText(/source assertions/i);
  await expect(conn).toContainText(/computed by Atlas/i);
});

test('year filter removes a candidate and its edge', async ({ page }) => {
  await page.goto(`${FIXTURE}&sel=SYNA15`);
  const panel = page.getByTestId('panel');
  const candidates = panel.getByRole('button', { name: 'Why this connection?' });
  await expect(candidates.first()).toBeVisible();
  const before = await candidates.count();
  const candEdges = page.locator('[data-edge-type="CONVERSATION_CANDIDATE"]');
  const edgesBefore = await candEdges.count();
  // Move the start year to the latest year in the data: most pairs then fail.
  const to = page.getByLabel('To year');
  const max = await to.inputValue();
  await page.getByLabel('From year').fill(max);
  await expect(page).toHaveURL(/years=/);
  await expect.poll(async () => candidates.count()).toBeLessThan(before);
  expect(await candEdges.count()).toBeLessThanOrEqual(edgesBefore);
});

test('invalid ?sel shows a non-blocking notice', async ({ page }) => {
  await page.goto(`${FIXTURE}&sel=DOES-NOT-EXIST`);
  await expect(page.getByTestId('not-found')).toContainText('Item not found in this snapshot');
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 740 } });
  test('selection opens a bottom sheet', async ({ page }) => {
    await page.goto(FIXTURE);
    await searchAndPick(page, 'Person O', /Test Person O/);
    const panel = page.getByTestId('panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeGreaterThan(700);
    expect(box!.width).toBeGreaterThan(360);
  });
});

test('list view is keyboard navigable', async ({ page }) => {
  await page.goto(`${FIXTURE}&view=list`);
  const list = page.getByTestId('list-view');
  await expect(list).toBeVisible();
  const first = list.getByRole('button').first();
  await first.focus();
  await expect(first).toBeFocused();
  const name = (await first.textContent()) ?? '';
  await page.keyboard.press('Tab');
  await expect(list.getByRole('button').nth(1)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('panel').getByRole('heading', { name })).toBeVisible();
});

test('never calls api.openalex.org', async ({ page }) => {
  const hits = trackOpenAlex(page);
  await page.goto(`${FIXTURE}&sel=SYNA15`);
  await page.getByRole('button', { name: 'Coverage' }).click();
  await expect(page.getByTestId('coverage-panel')).toBeVisible();
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.getByTestId('list-view')).toBeVisible();
  expect(hits).toEqual([]);
});
