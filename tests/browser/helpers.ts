import Decimal from 'decimal.js';
import { type APIRequestContext, type Page, expect } from '@playwright/test';

/**
 * Exact decimal helpers for assertions. Money and stock cross the API as exact
 * strings, so the suite compares exact strings: converting them to a JavaScript
 * number would silently accept a lost cent, which is the invariant this project
 * treats as mandatory.
 */
export const dec = (value: Decimal.Value): Decimal => new Decimal(value ?? 0);
export const money = (value: Decimal.Value): string => dec(value).toDecimalPlaces(2).toFixed(2);

export type Credentials = { username: string; password: string };
export type JsonRecord = Record<string, unknown>;

/**
 * The synthetic development identity seeded by scripts/local-seed.mjs. It owns
 * tenant 1 and holds ROLE_ADMIN, so it can provision further test fixtures.
 *
 * The seed honours PIROT_DEV_PASSWORD, so every consumer must read it from here
 * rather than repeating the documented default.
 */
export const DEVELOPER_PASSWORD = process.env.PIROT_DEV_PASSWORD ?? 'Synthetic-local-password-42';
export const DEVELOPER: Credentials = { username: 'developer', password: DEVELOPER_PASSWORD };

/**
 * Provisioned by tests/browser/setup.ts, which grants it a non-zero discount
 * ceiling. The ceiling is cooperative configuration, not a fixed tenant id.
 */
export const SECONDARY_TENANT_ID = 2;

export const posSaveButton = (page: Page) => page.locator('#save-entity-desktop:visible, #save-entity:visible');

export const uniqueName = (prefix: string) => `${prefix} ${crypto.randomUUID().slice(0, 8)}`;

/** Mirrors the server's quarter-TL rounding so specs can predict authoritative totals. */

const tokens = new Map<string, string>();

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() };
}

/** Exercise the real login once per identity, then reuse the signed session in the API. */
export async function authenticate(request: APIRequestContext, credentials: Credentials = DEVELOPER): Promise<string> {
  const cached = tokens.get(credentials.username);
  if (cached) return cached;
  const response = await request.post('/api/authenticate', { data: credentials });
  expect(response.status(), `POST /api/authenticate for ${credentials.username}`).toBe(200);
  const { id_token } = (await response.json()) as { id_token: string };
  tokens.set(credentials.username, id_token);
  return id_token;
}

/** Issue a tenant-scoped API call and fail loudly with the response body on failure. */
export async function api<T = JsonRecord>(
  request: APIRequestContext,
  path: string,
  init: { method?: string; data?: Record<string, unknown>; token?: string } = {},
): Promise<T> {
  const { method = 'GET', data, token } = init;
  const response = await request.fetch(`/api/${path}`, { method, data, headers: headers(token ?? (await authenticate(request))) });
  const body = response.status() === 204 ? '' : await response.text();
  if (!response.ok()) throw new Error(`${method} /api/${path} -> ${response.status()} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

export async function createTenant(request: APIRequestContext, tenantName: string): Promise<{ id: number; tenantName: string }> {
  return api(request, 'tenants', { method: 'POST', data: { tenantName } });
}

export async function registerUser(
  request: APIRequestContext,
  input: { tenantId: number; login: string; password: string; activated?: boolean; langKey?: string },
): Promise<Credentials> {
  await api(request, 'register', {
    method: 'POST',
    data: {
      login: input.login,
      password: input.password,
      email: `${input.login}@example.invalid`,
      tenantId: input.tenantId,
      activated: input.activated ?? true,
      langKey: input.langKey ?? 'tr',
    },
  });
  return { username: input.login, password: input.password };
}

export async function createProduct(
  request: APIRequestContext,
  input: { name: string; stock: string; price: string; unit?: string; token?: string },
): Promise<{ id: number }> {
  return api(request, 'uruns', {
    method: 'POST',
    token: input.token,
    data: {
      urunAdi: input.name,
      stok: input.stock,
      stokSiniri: '0',
      musteriFiyati: input.price,
      birim: input.unit ?? 'ADET',
      urunKategorisi: 'GIDA',
      active: true,
      satista: true,
    },
  });
}

export type Sale = { id: number; toplamTutar: string; odendi: boolean; kartliSatis: boolean; sonraOdeme: boolean; iptal: boolean };

export async function createSale(
  request: APIRequestContext,
  productId: number,
  quantity: number,
  options: { id?: number; card?: boolean; deferred?: boolean; discount?: number; token?: string } = {},
): Promise<Sale> {
  const data: Record<string, unknown> = {
    tarih: new Date().toISOString(),
    stokHareketleriLists: [{ urunId: productId, miktar: quantity }],
    ortagaSatis: false,
    kartliSatis: !!options.card,
    sonraOdeme: !!options.deferred,
  };
  if (options.id) data.id = options.id;
  if (options.discount) data.indirim = options.discount;
  return api(request, 'satis', { method: 'POST', data, token: options.token });
}

export async function sale(request: APIRequestContext, saleId: number, token?: string): Promise<Sale> {
  return api(request, `satis/${saleId}`, { token });
}

/** Reads the authoritative tenant cash balance (the latest append-only ledger row). */
export async function cash(request: APIRequestContext, token?: string): Promise<string> {
  const rows = await api<Array<{ kasaMiktar: string }>>(request, 'kasa-hareketleris?page=0&size=1&sort=id,desc', { token });
  return money(rows.length ? rows[0].kasaMiktar : 0);
}

export async function stock(request: APIRequestContext, productId: number, token?: string): Promise<string> {
  return String((await api<{ stok: string }>(request, `uruns/${productId}`, { token })).stok);
}

export type Debt = { id: number; hareketTipi: string; odemeAraci: string; tutar: string; satis?: number | { id?: number } | null };

export async function debtsForSale(request: APIRequestContext, saleId: number, token?: string): Promise<Debt[]> {
  const rows = await api<Debt[]>(request, 'borc-alacaks?page=0&size=200&sort=id,desc', { token });
  return rows.filter(debt => {
    const linked = debt.satis && typeof debt.satis === 'object' ? debt.satis.id : debt.satis;
    return linked === saleId;
  });
}

export async function findEntity<T extends Record<string, unknown>>(
  request: APIRequestContext,
  path: string,
  field: string,
  value: string,
  token?: string,
): Promise<T> {
  const rows = await api<T[]>(request, `${path}?page=0&size=200&sort=id,desc`, { token });
  const match = rows.find(row => String(row[field] ?? '') === value);
  if (!match) throw new Error(`Expected ${path} to contain ${field}="${value}"`);
  return match;
}

/** Best-effort cleanup; an entity already removed through the UI reports 404 and is skipped. */
export async function remove(request: APIRequestContext, path: string, id: number | string, token?: string): Promise<void> {
  const response = await request.delete(`/api/${path}/${id}`, { headers: headers(token ?? (await authenticate(request))) });
  if (![204, 404].includes(response.status()))
    throw new Error(`DELETE /api/${path}/${id} -> ${response.status()} ${await response.text()}`);
}

export async function missing(request: APIRequestContext, path: string, id: number | string, token?: string): Promise<boolean> {
  const response = await request.get(`/api/${path}/${id}`, { headers: headers(token ?? (await authenticate(request))) });
  if (response.status() === 404) return true;
  if (response.ok()) return false;
  throw new Error(`GET /api/${path}/${id} -> ${response.status()}`);
}

/**
 * Signs the browser in by injecting a signed API session. This keeps every spec
 * on one cached token instead of spending real login attempts from the rate limit.
 */
export async function signIn(page: Page, request: APIRequestContext, credentials: Credentials = DEVELOPER): Promise<void> {
  const jwt = await authenticate(request, credentials);
  await page.addInitScript(token => sessionStorage.setItem('koop-authenticationToken', JSON.stringify(token)), jwt);
  await page.goto('/');
  // The first navigation in a run also pays the dev-server cold start on CI.
  await expect(page.locator('#account-menu')).toBeVisible({ timeout: 20_000 });
}

/** Adds a product to the POS cart through the real search listbox. */
export async function addProductToCart(page: Page, name: string): Promise<void> {
  const search = page.locator('.urun-arama input[role="combobox"]');
  await search.click();
  await search.fill(name);
  const option = page.getByRole('option', { name: new RegExp(`^${name}`) });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
}

/**
 * Opens the POS editor. The product search autofocuses on load and its listbox
 * overlays the cart and action buttons, so it must be dismissed first.
 */
export async function gotoSaleEditor(page: Page, saleId: number): Promise<void> {
  await page.goto(`/satis/${saleId}/edit`, { waitUntil: 'domcontentloaded' });
  const search = page.locator('.urun-arama input[role="combobox"]');
  await expect(search).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 });
  await search.press('Escape');
  await expect(page.locator('#satis-urun-sonuclari')).toHaveCount(0);
}

export async function deleteThroughDialog(page: Page, route: string, id: number): Promise<void> {
  await page.goto(`/${route}/${id}/delete`, { waitUntil: 'domcontentloaded' });
  const dialog = page.locator('.modal-content');
  await expect(dialog).toContainText(String(id), { timeout: 15_000 });
  await dialog.locator('[data-cy="entityConfirmDeleteButton"]').click();
  await page.waitForURL(new RegExp(`/${route}(\\?|$)`), { timeout: 15_000 });
}
