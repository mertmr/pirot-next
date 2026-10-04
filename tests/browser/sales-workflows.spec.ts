import { test, expect } from '@playwright/test';
import {
  SECONDARY_TENANT_ID,
  addProductToCart,
  authenticate,
  cash,
  createProduct,
  createSale,
  createTenant,
  debtsForSale,
  dec,
  gotoSaleEditor,
  missing,
  money,
  posSaveButton,
  registerUser,
  remove,
  sale,
  signIn,
  stock,
  uniqueName,
} from './helpers';

test('an edited deferred sale stays deferred and keeps its debt in sync', async ({ page, request }) => {
  const name = uniqueName('E2E deferred');
  const product = await createProduct(request, { name, stock: '10', price: '12.50' });
  const cash0 = await cash(request);
  const stock0 = await stock(request, product.id);
  const created = await createSale(request, product.id, 1, { deferred: true });
  const saleId = created.id;
  try {
    expect(created.odendi).toBe(false);
    await signIn(page, request);
    await gotoSaleEditor(page, saleId);

    const line = page.locator('article.sepet-satiri', { hasText: name });
    await expect(line).toBeVisible({ timeout: 15_000 });

    // The edit screen warns about recomputation and shows the persisted total.
    await expect(page.getByText('Bu satışın stok ve kasa etkileri yeniden hesaplanacaktır')).toBeVisible();
    await expect(page.getByText('Önceki toplam')).toBeVisible();

    // An already-deferred sale cannot switch payment method while editing.
    const paymentGroup = page.getByRole('radiogroup', { name: 'Ödeme türü' });
    await expect(paymentGroup.getByRole('radio', { name: 'Sonradan ödeme' })).toHaveAttribute('aria-checked', 'true');
    await expect(paymentGroup.getByRole('radio', { name: 'Nakit' })).toBeDisabled();
    await expect(paymentGroup.getByRole('radio', { name: 'Kart' })).toBeDisabled();

    await line.getByRole('button', { name: 'Miktarı artır' }).click();
    await expect(line.getByRole('spinbutton')).toHaveValue('2');

    await posSaveButton(page).click();
    await page.waitForURL(/\/satis(\?|$)/, { timeout: 15_000 });

    const updated = await sale(request, saleId);
    expect(updated.toplamTutar).toBe('25.00');
    expect(updated.odendi).toBe(false);
    expect(updated.sonraOdeme).toBe(true);

    // The deferred debt follows the new total; cash is never touched.
    const debts = await debtsForSale(request, saleId);
    expect(debts).toHaveLength(1);
    expect(debts[0].hareketTipi).toBe('BORC');
    expect(debts[0].odemeAraci).toBe('SONRA_ODEME');
    expect(debts[0].tutar).toBe('25.00');
    expect(await cash(request)).toBe(cash0);
    expect(await stock(request, product.id)).toBe(dec(stock0).minus('2').toString());
  } finally {
    await remove(request, 'satis', saleId);
    await remove(request, 'uruns', product.id);
  }
  expect(await debtsForSale(request, saleId)).toHaveLength(0);
  expect(await stock(request, product.id)).toBe(stock0);
  expect(await cash(request)).toBe(cash0);
});

test('deleting a deferred sale through the dialog removes its debt and restores stock', async ({ page, request }) => {
  const name = uniqueName('E2E deferred delete');
  const product = await createProduct(request, { name, stock: '10', price: '12.50' });
  const cash0 = await cash(request);
  const stock0 = await stock(request, product.id);
  const saleId = (await createSale(request, product.id, 1, { deferred: true })).id;
  try {
    expect(await debtsForSale(request, saleId)).toHaveLength(1);
    await signIn(page, request);
    await page.goto(`/satis/${saleId}/delete`, { waitUntil: 'domcontentloaded' });

    // The dialog only becomes actionable once the persisted sale is loaded.
    const dialog = page.locator('.modal-content');
    await expect(dialog).toContainText(String(saleId), { timeout: 15_000 });
    await dialog.locator('[data-cy="entityConfirmDeleteButton"]').click();
    await page.waitForURL(/\/satis(\?|$)/, { timeout: 15_000 });

    expect(await missing(request, 'satis', saleId)).toBe(true);
    expect(await debtsForSale(request, saleId)).toHaveLength(0);
  } finally {
    await remove(request, 'satis', saleId);
    await remove(request, 'uruns', product.id);
  }
  expect(await stock(request, product.id)).toBe(stock0);
  expect(await cash(request)).toBe(cash0);
});

test('the first quantity of a low-stock GRAM product clamps to the available stock', async ({ page, request }) => {
  const name = uniqueName('E2E gram');
  const product = await createProduct(request, { name, stock: '25', price: '100.00', unit: 'GRAM' });
  try {
    await signIn(page, request);
    await page.goto('/satis/new', { waitUntil: 'domcontentloaded' });
    await expect(posSaveButton(page)).toBeVisible({ timeout: 10_000 });
    await addProductToCart(page, name);

    const line = page.locator('article.sepet-satiri', { hasText: name });
    await expect(line).toBeVisible();
    await expect(line.getByRole('spinbutton')).toHaveValue('25');
    await expect(line).toContainText('Stok: 25');
  } finally {
    await remove(request, 'uruns', product.id);
  }
});

test('repeated products merge into one cart line', async ({ page, request }) => {
  const name = uniqueName('E2E merge');
  const product = await createProduct(request, { name, stock: '200', price: '9.00' });
  try {
    await signIn(page, request);
    await page.goto('/satis/new', { waitUntil: 'domcontentloaded' });
    await expect(posSaveButton(page)).toBeVisible({ timeout: 10_000 });
    await addProductToCart(page, name);
    await addProductToCart(page, name);

    await expect(page.locator('article.sepet-satiri')).toHaveCount(1);
    await expect(page.locator('article.sepet-satiri').getByRole('spinbutton')).toHaveValue('2');
  } finally {
    await remove(request, 'uruns', product.id);
  }
});

test('checkout persists a fractional cash amount exactly and reverses it on deletion', async ({ page, request }) => {
  const name = uniqueName('E2E exact cash');
  const product = await createProduct(request, { name, stock: '5', price: '12.25' });
  const cash0 = await cash(request);
  let saleId: number | undefined;
  try {
    await signIn(page, request);
    await page.goto('/satis/new', { waitUntil: 'domcontentloaded' });
    await expect(posSaveButton(page)).toBeVisible({ timeout: 10_000 });
    await addProductToCart(page, name);
    await page.getByRole('button', { name: 'Tam tutar', exact: true }).click();
    await expect(page.locator('#satis-nakit')).toHaveValue('12.25');

    const saved = page.waitForResponse(r => r.url().endsWith('/api/satis') && r.request().method() === 'POST');
    await posSaveButton(page).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; toplamTutar: string };
    saleId = created.id;
    expect(created.toplamTutar).toBe('12.25');
    await expect(page.getByText('Satış tamamlandı', { exact: true })).toBeVisible();
    expect(await cash(request)).toBe(money(dec(cash0).plus('12.25')));
    expect(await stock(request, product.id)).toBe('4');
  } finally {
    if (saleId) await remove(request, 'satis', saleId);
    await remove(request, 'uruns', product.id);
  }
  expect(await cash(request)).toBe(cash0);
  expect(await stock(request, product.id)).toBe('5');
});

test('a configured discount ceiling rounds at the quarter boundary through the checkout', async ({ page, request }) => {
  const login = `rounding-${crypto.randomUUID().slice(0, 8)}`;
  const credentials = await registerUser(request, { tenantId: SECONDARY_TENANT_ID, login, password: 'Synthetic-rounding-password-42' });
  const token = await authenticate(request, credentials);
  const name = uniqueName('E2E discount');
  const product = await createProduct(request, { name, stock: '5', price: '1.25', token });
  const cash0 = await cash(request, token);
  let saleId: number | undefined;
  try {
    await signIn(page, request, credentials);
    await page.goto('/satis/new', { waitUntil: 'domcontentloaded' });
    await expect(posSaveButton(page)).toBeVisible({ timeout: 10_000 });
    await addProductToCart(page, name);
    await page.getByText('Diğer seçenekler', { exact: true }).click();
    await page.locator('#satis-indirim').fill('10');
    await page.getByRole('button', { name: 'Tam tutar', exact: true }).click();
    await expect(page.locator('#satis-nakit')).toHaveValue('1.25');

    const saved = page.waitForResponse(r => r.url().endsWith('/api/satis') && r.request().method() === 'POST');
    await posSaveButton(page).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number; toplamTutar: string };
    saleId = created.id;
    expect(created.toplamTutar).toBe('1.25');
    await expect(page.getByText('Satış tamamlandı', { exact: true })).toBeVisible();
    expect(await cash(request, token)).toBe(money(dec(cash0).plus('1.25')));
    expect(await stock(request, product.id, token)).toBe('4');

    await remove(request, 'satis', saleId, token);
    saleId = undefined;
    expect(await cash(request, token)).toBe(cash0);
    expect(await stock(request, product.id, token)).toBe('5');
  } finally {
    if (saleId) await remove(request, 'satis', saleId, token);
    await remove(request, 'uruns', product.id, token);
    await remove(request, 'admin/users', login);
  }
});

test('the sale list shows the empty state, then columns, search and pagination once a record exists', async ({ page, request }) => {
  const login = `list-${crypto.randomUUID().slice(0, 8)}`;
  const tenant = await createTenant(request, uniqueName('E2E list cooperative'));
  const credentials = await registerUser(request, { tenantId: tenant.id, login, password: 'Synthetic-list-password-42' });
  const token = await authenticate(request, credentials);
  const product = await createProduct(request, { name: uniqueName('E2E list product'), stock: '10', price: '10.00', token });
  let saleId: number | undefined;
  try {
    await signIn(page, request, credentials);
    await page.goto('/satis', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#satis-heading')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#jh-create-entity')).toBeEnabled();
    await expect(page.getByText(/No Satis found|Satış bulunamadı/i)).toBeVisible({ timeout: 10_000 });

    saleId = (await createSale(request, product.id, 1, { token })).id;
    await page.goto('/satis', { waitUntil: 'domcontentloaded' });
    const table = page.locator('.table-responsive table');
    await expect(table).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('th:has-text("ID")')).toBeVisible();
    const row = page.locator('tbody tr', { hasText: String(saleId) });
    await expect(row).toBeVisible();
    await expect(row.locator('td').nth(2)).toHaveText('10.00');

    // Search input and button, then pagination for the existing record set.
    await expect(page.locator('input[placeholder="Kullanıcıya Göre Satış Ara"]')).toBeVisible();
    await expect(page.locator('button:has(svg[data-icon="magnifying-glass"])')).toBeVisible();
    await expect(page.locator('.pagination')).toBeVisible();
  } finally {
    if (saleId) await remove(request, 'satis', saleId, token);
    await remove(request, 'uruns', product.id, token);
    await remove(request, 'admin/users', login);
  }
});
