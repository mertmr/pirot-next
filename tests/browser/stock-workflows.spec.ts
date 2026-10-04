import { test, expect } from '@playwright/test';
import { createProduct, dec, deleteThroughDialog, findEntity, remove, signIn, stock, uniqueName } from './helpers';

async function selectProduct(page: import('@playwright/test').Page, productId: number): Promise<void> {
  const option = page.locator(`#stok-girisi-urun option[value="${productId}"]`);
  await expect(option).toHaveCount(1);
  await page.locator('#stok-girisi-urun').selectOption(String(productId));
}

test('creating, editing and deleting a STOK_GIRISI compensates product stock', async ({ page, request }) => {
  const name = uniqueName('E2E stock product');
  const product = await createProduct(request, { name, stock: '40', price: '30.00' });
  const note = uniqueName('E2E stok girisi');
  const stock0 = await stock(request, product.id);
  let movementId: number | undefined;
  try {
    await signIn(page, request);
    await page.goto('/stok-girisi/new', { waitUntil: 'domcontentloaded' });
    await selectProduct(page, product.id);
    await expect(page.getByText(`Güncel Stok: ${stock0} ADET`)).toBeVisible();

    await page.locator('#stok-girisi-miktar').fill('7');
    await expect(page.locator('[data-cy="yeni-stok"]')).toContainText(`Kaydedilecek Yeni Stok: ${dec(stock0).plus('7')} ADET`);
    await page.locator('#stok-girisi-notlar').fill(note);
    await page.locator('#save-entity').click();
    await page.waitForURL(/\/stok-girisi(\?|$)/, { timeout: 15_000 });

    movementId = (await findEntity<{ id: number }>(request, 'stok-girisis', 'notlar', note)).id;
    expect(await stock(request, product.id)).toBe(dec(stock0).plus('7').toString());

    // On edit the persisted effect is reverted before the replacement applies.
    await page.goto(`/stok-girisi/${movementId}/edit`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#stok-girisi-notlar')).toHaveValue(note);
    await expect(page.locator('[data-cy="yeni-stok"]')).toContainText(`Kaydedilecek Yeni Stok: ${dec(stock0).plus('7')} ADET`);

    await page.locator('#stok-girisi-miktar').fill('3');
    await expect(page.locator('[data-cy="yeni-stok"]')).toContainText(`Kaydedilecek Yeni Stok: ${dec(stock0).plus('3')} ADET`);
    await page.locator('#save-entity').click();
    await page.waitForURL(/\/stok-girisi(\?|$)/, { timeout: 15_000 });
    expect(await stock(request, product.id)).toBe(dec(stock0).plus('3').toString());

    await deleteThroughDialog(page, 'stok-girisi', movementId);
    expect(await stock(request, product.id)).toBe(stock0);
    movementId = undefined;
  } finally {
    if (movementId) await remove(request, 'stok-girisis', movementId);
    await remove(request, 'uruns', product.id);
  }
});

test('a FIRE beyond available stock is rejected without mutating stock', async ({ page, request }) => {
  const name = uniqueName('E2E fire product');
  const product = await createProduct(request, { name, stock: '10', price: '10.00' });
  const stock0 = await stock(request, product.id);
  try {
    await signIn(page, request);
    await page.goto('/stok-girisi/new', { waitUntil: 'domcontentloaded' });
    await selectProduct(page, product.id);
    await page.locator('#stok-girisi-miktar').fill('9999');
    await page.locator('#stok-girisi-stokHareketiTipi').selectOption('FIRE');
    await page.locator('#stok-girisi-notlar').fill(uniqueName('E2E fire'));

    const rejection = page.waitForResponse(r => r.url().includes('/api/stok-girisis') && r.request().method() === 'POST');
    await page.locator('#save-entity').click();
    const rejected = await rejection;
    expect(rejected.status()).toBe(409);
    expect(((await rejected.json()) as { errorKey: string }).errorKey).toBe('insufficientstock');

    // The server rejected the movement; the form stays put and stock is untouched.
    await expect(page).toHaveURL(/\/stok-girisi\/new/);
    expect(await stock(request, product.id)).toBe(stock0);
  } finally {
    await remove(request, 'uruns', product.id);
  }
});
