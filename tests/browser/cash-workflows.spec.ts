import { test, expect } from '@playwright/test';
import {
  cash,
  dec,
  money,
  createProduct,
  createSale,
  debtsForSale,
  deleteThroughDialog,
  findEntity,
  remove,
  sale,
  signIn,
  stock,
  uniqueName,
} from './helpers';

type Gider = { id: number; notlar: string };
type Virman = { id: number; notlar: string };

test('a NAKIT expense moves cash by its amount on create, update and delete', async ({ page, request }) => {
  const note = uniqueName('E2E nakit gider');
  const cash0 = await cash(request);
  let giderId: number | undefined;
  try {
    await signIn(page, request);
    await page.goto('/gider/new', { waitUntil: 'domcontentloaded' });
    await page.locator('#gider-tutar').fill('100.50');
    await page.locator('#gider-odemeAraci').selectOption('NAKIT');
    await page.locator('#gider-notlar').fill(note);
    await page.locator('#save-entity').click();
    await page.waitForURL(/\/gider(\?|$)/, { timeout: 15_000 });

    giderId = (await findEntity<Gider>(request, 'giders', 'notlar', note)).id;
    expect(await cash(request)).toBe(money(dec(cash0).minus('100.5')));
    await expect(page.locator('tbody tr', { hasText: note })).toBeVisible();

    // Editing the amount reverses the old ledger effect before applying the new one.
    await page.goto(`/gider/${giderId}/edit`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#gider-notlar')).toHaveValue(note);
    await page.locator('#gider-tutar').fill('40');
    await page.locator('#save-entity').click();
    await page.waitForURL(/\/gider(\?|$)/, { timeout: 15_000 });
    expect(await cash(request)).toBe(money(dec(cash0).minus('40')));

    await deleteThroughDialog(page, 'gider', giderId);
    expect(await cash(request)).toBe(cash0);
    giderId = undefined;
  } finally {
    if (giderId) await remove(request, 'giders', giderId);
  }
  expect(await cash(request)).toBe(cash0);
});

test('a BANKA expense never touches cash', async ({ page, request }) => {
  const note = uniqueName('E2E banka gider');
  const cash0 = await cash(request);
  let giderId: number | undefined;
  try {
    await signIn(page, request);
    await page.goto('/gider/new', { waitUntil: 'domcontentloaded' });
    await page.locator('#gider-tutar').fill('55.25');
    await page.locator('#gider-odemeAraci').selectOption('BANKA');
    await page.locator('#gider-notlar').fill(note);
    await page.locator('#save-entity').click();
    await page.waitForURL(/\/gider(\?|$)/, { timeout: 15_000 });

    giderId = (await findEntity<Gider>(request, 'giders', 'notlar', note)).id;
    expect(await cash(request)).toBe(cash0);

    await deleteThroughDialog(page, 'gider', giderId);
    expect(await cash(request)).toBe(cash0);
    giderId = undefined;
  } finally {
    if (giderId) await remove(request, 'giders', giderId);
  }
  expect(await cash(request)).toBe(cash0);
});

test('a KASA to BANKA transfer is reversed when it is updated and deleted', async ({ page, request }) => {
  const note = uniqueName('E2E virman');
  const cash0 = await cash(request);
  let virmanId: number | undefined;
  try {
    await signIn(page, request);
    await page.goto('/virman/new', { waitUntil: 'domcontentloaded' });
    await page.locator('#virman-tutar').fill('75.25');
    await page.locator('#virman-cikisHesabi').selectOption('KASA');
    await page.locator('#virman-girisHesabi').selectOption('BANKA');
    await page.locator('#virman-notlar').fill(note);
    await page.locator('#save-entity').click();
    await page.waitForURL(/\/virman(\?|$)/, { timeout: 15_000 });

    virmanId = (await findEntity<Virman>(request, 'virmen', 'notlar', note)).id;
    expect(await cash(request)).toBe(money(dec(cash0).minus('75.25')));

    // Flipping the direction reverses the old effect before applying the new one.
    await page.goto(`/virman/${virmanId}/edit`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#virman-notlar')).toHaveValue(note);
    await page.locator('#virman-cikisHesabi').selectOption('BANKA');
    await page.locator('#virman-girisHesabi').selectOption('KASA');
    await page.locator('#save-entity').click();
    await page.waitForURL(/\/virman(\?|$)/, { timeout: 15_000 });
    expect(await cash(request)).toBe(money(dec(cash0).plus('75.25')));

    await deleteThroughDialog(page, 'virman', virmanId);
    expect(await cash(request)).toBe(cash0);
    virmanId = undefined;
  } finally {
    if (virmanId) await remove(request, 'virmen', virmanId);
  }
  expect(await cash(request)).toBe(cash0);
});

test('a KASA to KASA transfer is rejected without changing cash', async ({ page, request }) => {
  const cash0 = await cash(request);
  await signIn(page, request);
  await page.goto('/virman/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#virman-tutar').fill('10');
  await page.locator('#virman-cikisHesabi').selectOption('KASA');
  await page.locator('#virman-girisHesabi').selectOption('KASA');
  await page.locator('#virman-notlar').fill(uniqueName('E2E virman ayni hesap'));

  const rejected = page.waitForResponse(r => r.url().endsWith('/api/virmen') && r.request().method() === 'POST');
  await page.locator('#save-entity').click();
  const response = await rejected;
  expect(response.status()).toBe(400);
  expect(((await response.json()) as { errorKey: string }).errorKey).toBe('invalidpayment');
  await expect(page).toHaveURL(/\/virman\/new/);
  expect(await cash(request)).toBe(cash0);
});

test('collecting a deferred payment from the debt list credits cash and settles the debt', async ({ page, request }) => {
  const name = uniqueName('E2E debt');
  const product = await createProduct(request, { name, stock: '10', price: '12.50' });
  const cash0 = await cash(request);
  const stock0 = await stock(request, product.id);
  const saleId = (await createSale(request, product.id, 1, { deferred: true })).id;
  try {
    const debts = await debtsForSale(request, saleId);
    expect(debts).toHaveLength(1);
    const debt = debts[0];
    expect(debt.hareketTipi).toBe('BORC');
    expect(debt.odemeAraci).toBe('SONRA_ODEME');

    await signIn(page, request);
    await page.goto('/borc-alacak', { waitUntil: 'domcontentloaded' });
    const row = page.locator('tbody tr', { hasText: String(debt.id) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('[data-cy="collectPaymentButton"]').click();

    const dialog = page.locator('.modal-content');
    await expect(dialog).toBeVisible();
    const confirm = dialog.locator('[data-cy="confirmCollectPayment"]');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('radio', { name: 'Nakit (Peşin)' }).check();
    await confirm.click();

    // Success closes the dialog and refreshes the row into its settled state.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(row.locator('[data-cy="collectPaymentButton"]')).toHaveCount(0);
    await expect(row).toContainText('Nakit (Peşin)');

    // The server owns the cash and paid-state effects.
    expect(await cash(request)).toBe(money(dec(cash0).plus(String(debt.tutar))));
    const settled = await debtsForSale(request, saleId);
    expect(settled).toHaveLength(1);
    expect(settled[0].hareketTipi).toBe('ODEME');
    expect(settled[0].odemeAraci).toBe('NAKIT');
    const record = await sale(request, saleId);
    expect(record.odendi).toBe(true);
    expect(record.kartliSatis).toBe(false);
  } finally {
    await remove(request, 'satis', saleId);
    await remove(request, 'uruns', product.id);
  }
  expect(await cash(request)).toBe(cash0);
  expect(await stock(request, product.id)).toBe(stock0);
});
