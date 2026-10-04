import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  SECONDARY_TENANT_ID,
  api,
  authenticate,
  cash,
  createProduct,
  createSale,
  dec,
  money,
  registerUser,
  sale,
  signIn,
  stock,
  uniqueName,
} from './helpers';

type Shift = {
  id: number;
  acilisId: number;
  kasa: string;
  pirot: string;
  fark: string;
  farkDenge: string;
  kapanisDokumu: string;
};

async function countShiftRows(page: Page): Promise<number> {
  await page.goto('/nobet-hareketleri', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#nobet-hareketleri-heading')).toBeVisible({ timeout: 10_000 });
  return page.locator('.table-responsive table tbody tr').count();
}

// Local databases may hold a residue from manual use; CI starts clean. Closing an
// active opening first makes the journey start from the idle state either way.
async function closeActiveShift(page: Page): Promise<void> {
  await page.locator('[data-cy="money-100"]').fill('1');
  const difference = await page.locator('[data-cy="fark"]').inputValue();
  if (difference !== '0.00') await page.locator('[data-cy="notlar"]').fill('E2E: önceki açılışın kapanışı');
  await page.locator('#save-entity').click();
  await expect(page).toHaveURL(/\/nobet-hareketleri(\?|$)/, { timeout: 15_000 });
}

async function shift(request: APIRequestContext, token: string, action: 'ACILIS' | 'KAPANIS', note: string): Promise<Shift> {
  return api<Shift>(request, 'nobet-hareketleris', {
    method: 'POST',
    token,
    data: { acilisKapanis: action, kasa: await cash(request, token), notlar: note },
  });
}

test('opens a shift with an explained cash difference, closes it balanced, and returns to idle', async ({ page, request }) => {
  await signIn(page, request);
  const baselineRows = await countShiftRows(page);

  await page.goto('/nobet-hareketleri/new', { waitUntil: 'domcontentloaded' });
  const startHeading = page.getByRole('heading', { name: /Nöbeti Başlat/ });
  const closeHeading = page.getByRole('heading', { name: /Nöbeti Kapat/ });
  await expect(startHeading.or(closeHeading)).toBeVisible({ timeout: 10_000 });

  let rowCount = baselineRows;
  if (await closeHeading.isVisible()) {
    await closeActiveShift(page);
    rowCount += 1;
  }

  // Idle state: the server dictates an opening with its own system cash.
  await page.goto('/nobet-hareketleri/new', { waitUntil: 'domcontentloaded' });
  await expect(startHeading).toBeVisible({ timeout: 10_000 });
  const expectedCash = Number.parseFloat(await page.locator('[data-cy="expected-cash"]').innerText());
  expect(Number.isFinite(expectedCash)).toBe(true);

  const save = page.locator('#save-entity');
  await expect(save).toBeDisabled();

  // Count 100 TL: unless it matches the system cash, an explanation is mandatory.
  await page.locator('[data-cy="money-100"]').fill('1');
  await expect(page.locator('[data-cy="kasa"]')).toHaveValue('100.00');
  const difference = (100 - expectedCash).toFixed(2);
  await expect(page.locator('[data-cy="fark"]')).toHaveValue(difference);
  if (difference !== '0.00') {
    await expect(save).toBeDisabled();
    await expect(page.locator('[data-cy="notlar"]')).toHaveClass(/is-invalid/);
    await page.locator('[data-cy="notlar"]').fill('E2E: kasa farkı açıklaması');
  }
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page).toHaveURL(/\/nobet-hareketleri(\?|$)/, { timeout: 15_000 });
  await expect(page.locator('.table-responsive table tbody tr')).toHaveCount(++rowCount);

  // With an active opening the screen becomes the closing view and shows the
  // server-computed expected cash. Counting a shift never moves the ledger.
  await page.goto('/nobet-hareketleri/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Nöbeti Kapat/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-cy="expected-cash-breakdown"]')).toBeVisible();
  await expect(page.locator('[data-cy="pirot"]')).toHaveValue(expectedCash.toFixed(2));

  await page.locator('[data-cy="money-100"]').fill('1');
  const closeDifference = (100 - expectedCash).toFixed(2);
  await expect(page.locator('[data-cy="fark"]')).toHaveValue(closeDifference);
  if (closeDifference !== '0.00') await page.locator('[data-cy="notlar"]').fill('E2E: kapanış farkı açıklaması');
  await page.locator('#save-entity').click();

  await expect(page).toHaveURL(/\/nobet-hareketleri(\?|$)/, { timeout: 15_000 });
  await expect(page.locator('.table-responsive table tbody tr')).toHaveCount(rowCount + 1);

  // The lifecycle is complete: the next visit starts a new opening.
  await page.goto('/nobet-hareketleri/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Nöbeti Başlat/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-cy="expected-cash"]')).toBeVisible();
});

// This journey deliberately retains closed history on a disposable database;
// closed evidence must never be deleted as cleanup.
test('closed sale cancellation defers cash until confirmed settlement and preserves both closings', async ({ page, request }) => {
  const login = `shift-correction-${crypto.randomUUID().slice(0, 8)}`;
  const credentials = await registerUser(request, { tenantId: SECONDARY_TENANT_ID, login, password: 'Synthetic-correction-password-42' });
  const token = await authenticate(request, credentials);
  const fixture = uniqueName('E2E correction');
  const product = await createProduct(request, { name: fixture, stock: '5', price: '100.00', token });
  await api(request, 'virmen', {
    method: 'POST',
    token,
    data: { tarih: new Date().toISOString(), tutar: 1000, girisHesabi: 'KASA', cikisHesabi: 'BANKA', notlar: fixture },
  });
  const baseline = await cash(request, token);
  await shift(request, token, 'ACILIS', fixture);
  const created = await createSale(request, product.id, 1, { token });
  const closing = await shift(request, token, 'KAPANIS', fixture);
  const opening = await shift(request, token, 'ACILIS', fixture);

  await signIn(page, request, credentials);
  await page.goto(`/satis/${created.id}/delete`);
  const cancel = page.getByRole('button', { name: 'İptali kaydet', exact: true });
  await expect(cancel).toBeDisabled();
  await page.getByLabel('Düzeltme nedeni').fill(`${fixture}: refund will be delivered later`);
  await page.getByLabel('Nakit şimdi değişiyor mu?').selectOption('later');
  await expect(cancel).toBeEnabled();

  const cancelled = page.waitForResponse(r => r.url().includes(`/api/satis/${created.id}`) && r.request().method() === 'DELETE');
  await cancel.click();
  expect((await cancelled).status()).toBe(204);
  expect(await cash(request, token)).toBe(money(dec(baseline).plus('100')));
  expect(await stock(request, product.id, token)).toBe('5');
  expect((await sale(request, created.id, token)).iptal).toBe(true);

  // Settle the deferred refund from the shift that was open when the sale closed.
  await page.goto(`/nobet-hareketleri/${closing.id}`);
  await expect(page.getByRole('heading', { name: 'Kapanış anındaki kasa dökümü' })).toBeVisible();
  await page.getByRole('button', { name: 'Nakit ödemesini işle', exact: true }).click();
  const settled = page.waitForResponse(r => r.url().includes('/api/nobet-duzeltmeler/') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Evet, nakit teslim edildi', exact: true }).click();
  expect((await settled).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Nakit ödemesini işle', exact: true })).toHaveCount(0);
  expect(await cash(request, token)).toBe(baseline);

  const originalAfter = await api<Record<string, unknown>>(request, `nobet-hareketleris/${closing.id}`, { token });
  for (const field of ['kasa', 'pirot', 'fark', 'farkDenge', 'acilisId', 'kapanisDokumu']) {
    expect(originalAfter[field]).toEqual((closing as unknown as Record<string, unknown>)[field]);
  }

  const currentClosing = await shift(request, token, 'KAPANIS', fixture);
  expect(currentClosing.acilisId).toBe(opening.id);
  expect(currentClosing.kasa).toBe(baseline);
  expect(currentClosing.fark).toBe('0.00');

  const audits = await api<Array<Record<string, unknown>>>(request, `nobet-duzeltmeler/nobet/${currentClosing.id}`, { token });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    kaynakId: created.id,
    kapanisId: closing.id,
    nobetAcilisId: opening.id,
    bekleyenKasa: '0.00',
    odemeNobetId: opening.id,
  });
});
