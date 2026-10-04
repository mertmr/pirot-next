import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEVELOPER, signIn } from './helpers';
const password = DEVELOPER.password;
let cachedToken: string;
async function token(request: APIRequestContext) {
  if (cachedToken) return cachedToken;
  const response = await request.post('/api/authenticate', { data: { username: DEVELOPER.username, password } });
  expect(response.ok()).toBeTruthy();
  return (cachedToken = (await response.json()).id_token as string);
}
async function api(request: APIRequestContext, path: string, method = 'GET', data?: unknown) {
  const response = await request.fetch(`/api/${path}`, {
    method,
    data,
    headers: { authorization: `Bearer ${await token(request)}`, 'idempotency-key': crypto.randomUUID() },
  });
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}
async function cash(request: APIRequestContext) {
  return (await api(request, 'kasa-hareketleris?sort=id,desc'))[0].kasaMiktar;
}
test('cash sale create, edit, read-back, delete restores stock and cash', async ({ page, request }) => {
  const name = `Synthetic browser product ${crypto.randomUUID().slice(0, 8)}`,
    product = await api(request, 'uruns', 'POST', {
      urunAdi: name,
      birim: 'ADET',
      stok: '10',
      musteriFiyati: '10.00',
      active: true,
      satista: true,
    }),
    beforeCash = await cash(request);
  await signIn(page, request);
  await page.goto('/satis/new');
  await page.getByPlaceholder('Ürün ara…').fill(name);
  await page.locator('[role=option]').filter({ hasText: name }).click();
  const createdPromise = page.waitForResponse(r => r.url().includes('/api/satis') && r.request().method() === 'POST');
  await page.locator('#save-entity-desktop').click();
  const created = await (await createdPromise).json();
  await expect(page.getByText('Satış tamamlandı', { exact: true })).toBeVisible();
  expect(created.toplamTutar).toBe('10.00');
  await page.goto(`/satis/${created.id}/edit`);
  await page.getByLabel(`${name} miktarı`).fill('2');
  await expect(page.locator('[role=option]').filter({ hasText: name })).toContainText('10 ADET');
  const editedPromise = page.waitForResponse(r => r.url().includes('/api/satis') && r.request().method() === 'PUT');
  await page.locator('#save-entity-desktop').click();
  expect((await (await editedPromise).json()).toplamTutar).toBe('20.00');
  await page.goto(`/satis/${created.id}`);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  expect((await api(request, `uruns/${product.id}`)).stok).toBe('8');
  await page.goto(`/satis/${created.id}/delete`);
  await page.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(page).toHaveURL(/\/satis(?:\?|$)/);
  expect((await api(request, `uruns/${product.id}`)).stok).toBe('10');
  expect(await cash(request)).toBe(beforeCash);
});
test('Cloudflare administration and stock-report export work through authenticated UI', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/admin/operations');
  await expect(page.getByRole('heading', { name: 'Cloudflare İşlemleri' })).toBeVisible();
  await expect(page.getByText('Cloudflare D1 panelinde görüntüleyin')).toBeVisible();
  await expect(page.locator('[role=alert]')).toHaveCount(0);
  await page.goto('/reports/stock');
  await expect(page.getByRole('heading', { name: 'Ay sonu stok raporları' })).toBeVisible();
  await page.getByRole('button', { name: 'Rapor oluştur' }).click();
  await expect(page.getByText('Rapor hazırlanıyor. Listeyi yenileyerek indirebilirsiniz.')).toBeVisible();
  await expect(async () => {
    await page.getByRole('button', { name: 'Yenile', exact: true }).click();
    await expect(page.getByRole('button', { name: 'İndir' }).first()).toBeVisible();
  }).toPass({ timeout: 15000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'İndir' }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(await download.failure()).toBeNull();
});
// Keep route batches bounded and avoid exhausting the real login rate limit.
for (const paths of [
  ['/urun', '/uretici', '/kdv-kategorisi', '/kisiler', '/stok-girisi'],
  ['/gider', '/virman', '/borc-alacak', '/kasa-hareketleri', '/nobet-hareketleri'],
  ['/uretici-odemeleri', '/urun-fiyat-hesap', '/urun-fiyat', '/satis-stok-hareketleri', '/reports/ciro'],
  ['/reports/aylikSatislar', '/reports/aylikSatislarMali', '/reports/ortakFaturalar', '/reports/tukenme', '/admin/user-management'],
]) {
  test(`direct URLs ${paths.join(', ')} load without client errors`, async ({ page, request }) => {
    await signIn(page, request);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('h2').first(), path).toBeVisible();
      await expect(page.getByText('Beklenmeyen bir hata oluştu.'), path).toHaveCount(0);
      expect(errors, path).toEqual([]);
    }
  });
}

test('administrator creates and edits a tenant user through the form', async ({ page, request }) => {
  const login = `browser-${crypto.randomUUID().slice(0, 8)}`;
  await signIn(page, request);
  await page.goto('/admin/user-management/new');
  await page.locator('[name=login]').fill(login);
  await page.locator('[name=email]').fill(`${login}@example.invalid`);
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=firstName]').fill('Synthetic browser');
  await page.locator('[name=langKey]').selectOption('tr');
  const createdResponse = page.waitForResponse(r => r.url().includes('/api/admin/users') && r.request().method() === 'POST');
  await page.locator('[data-cy=entityCreateSaveButton]').click();
  const created = await createdResponse;
  expect(created.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/admin\/user-management(?:\?|$)/);
  await page.goto(`/admin/user-management/${login}/edit`);
  await expect(page.locator('[name=tenantId]')).toBeDisabled();
  await page.locator('[name=lastName]').fill('Edited');
  const editedResponse = page.waitForResponse(r => r.url().includes('/api/admin/users') && r.request().method() === 'PUT');
  await page.locator('[data-cy=entityCreateSaveButton]').click();
  expect((await editedResponse).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/admin\/user-management(?:\?|$)/);
  expect((await api(request, `admin/users/${login}`)).lastName).toBe('Edited');
  await api(request, `admin/users/${login}`, 'DELETE');
});

test('monthly reports render actual persisted product quantities', async ({ page, request }) => {
  const name = `Synthetic report product ${crypto.randomUUID().slice(0, 8)}`,
    product = await api(request, 'uruns', 'POST', {
      urunAdi: name,
      birim: 'ADET',
      stok: '10',
      musteriFiyati: '10.00',
      active: true,
      satista: true,
    });
  const created = await api(request, 'satis', 'POST', { stokHareketleriLists: [{ urunId: product.id, miktar: 2 }] });
  try {
    await signIn(page, request);
    await page.goto('/reports/aylikSatislar');
    const response = page.waitForResponse(r => r.url().includes(`getSatisRaporlari/${product.id}`));
    await page.locator('select').selectOption(String(product.id));
    expect((await response).ok()).toBeTruthy();
    await expect(page.locator('td').filter({ hasText: /^2$/ })).toBeVisible();
    const matrixResponse = page.waitForResponse(r => r.url().includes('getMaliSatisRaporlari'));
    await page.goto('/reports/aylikSatislarMali');
    expect((await matrixResponse).ok()).toBeTruthy();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  } finally {
    await api(request, `satis/${created.id}`, 'DELETE');
  }
});

test('native router preserves a protected URL, list query, and client history across form navigation', async ({ page }) => {
  await page.goto('/urun?page=1&sort=urunAdi,asc');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.locator('#username').fill('developer');
  await page.locator('#password').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page.locator('h2').first()).toBeVisible();
  await expect(page).toHaveURL(/\/urun\?/);
  expect(new URL(page.url()).searchParams.get('sort')).toBe('urunAdi,asc');
  await page.evaluate(() => {
    document.documentElement.dataset.navigationProof = 'same-document';
  });
  await page.locator('[data-cy=entityCreateButton]').click();
  await expect(page).toHaveURL(/\/urun\/new$/);
  await expect(page.locator('[data-cy=UrunCreateUpdateHeading]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.navigationProof)).toBe('same-document');
  await page.goBack();
  await expect(page).toHaveURL(/\/urun\?/);
  expect(new URL(page.url()).searchParams.get('sort')).toBe('urunAdi,asc');
  expect(await page.evaluate(() => document.documentElement.dataset.navigationProof)).toBe('same-document');
});

test('stock entry product changes preview and persist compensation for both products', async ({ page, request }) => {
  const products = await Promise.all(
    ['A', 'B'].map(suffix =>
      api(request, 'uruns', 'POST', {
        urunAdi: `Synthetic stock ${suffix} ${crypto.randomUUID().slice(0, 8)}`,
        birim: 'ADET',
        stok: '10',
        musteriFiyati: '10.00',
        active: true,
        satista: true,
      }),
    ),
  );
  const movement = await api(request, 'stok-girisis', 'POST', {
    urun: { id: products[0].id },
    miktar: 5,
    stokHareketiTipi: 'STOK_GIRISI',
    notlar: 'Synthetic browser entry',
  });
  try {
    await signIn(page, request);
    await page.goto(`/stok-girisi/${movement.id}/edit`);
    await page.locator('[name=urun]').selectOption(String(products[1].id));
    await page.locator('[name=miktar]').fill('3');
    await expect(page.getByText('Kaydedilecek Yeni Stok: 13 ADET', { exact: true })).toBeVisible();
    const saved = page.waitForResponse(r => r.url().includes('/api/stok-girisis') && r.request().method() === 'PUT');
    await page.locator('[data-cy=entityCreateSaveButton]').click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/stok-girisi(?:\?|$)/);
    expect((await api(request, `uruns/${products[0].id}`)).stok).toBe('10');
    expect((await api(request, `uruns/${products[1].id}`)).stok).toBe('13');
  } finally {
    await api(request, `stok-girisis/${movement.id}`, 'DELETE');
  }
  expect((await api(request, `uruns/${products[1].id}`)).stok).toBe('10');
});

test('checkout displays and persists the same exact amount above JavaScript safe integer limits', async ({ page, request }) => {
  const name = `Synthetic precise price ${crypto.randomUUID().slice(0, 8)}`,
    product = await api(request, 'uruns', 'POST', {
      urunAdi: name,
      birim: 'ADET',
      stok: '10',
      musteriFiyati: '9007199254740993.25',
      active: true,
      satista: true,
    }),
    beforeCash = await cash(request);
  await signIn(page, request);
  await page.goto('/satis/new');
  await page.getByPlaceholder('Ürün ara…').fill(name);
  await page.locator('[role=option]').filter({ hasText: name }).click();
  await expect(page.locator('.grand-total strong')).toHaveText('9.007.199.254.740.993,25 TL');
  const saved = page.waitForResponse(r => r.url().includes('/api/satis') && r.request().method() === 'POST');
  await page.locator('#save-entity-desktop').click();
  const result = await saved;
  expect(result.ok()).toBeTruthy();
  const created = await result.json();
  try {
    expect(created.toplamTutar).toBe('9007199254740993.25');
    expect((await api(request, `uruns/${product.id}`)).stok).toBe('9');
  } finally {
    await api(request, `satis/${created.id}`, 'DELETE');
  }
  expect(await cash(request)).toBe(beforeCash);
  expect((await api(request, `uruns/${product.id}`)).stok).toBe('10');
});
