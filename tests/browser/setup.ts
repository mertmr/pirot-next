import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { DEVELOPER } from './helpers';

const base = 'http://127.0.0.1:9071';
const SECONDARY_PASSWORD = 'Synthetic-secondary-password-42';

/**
 * Loads the client bundle once so the first spec does not pay the dev-server
 * cold start inside its own test timeout. Only the login screen is touched; no
 * session is created.
 */
async function warmClient() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('#username').waitFor({ state: 'visible', timeout: 120_000 });
  } finally {
    await browser.close();
  }
}

/**
 * Provisions the disposable browser fixtures: tenant 1 with the synthetic
 * developer identity, then tenant 2 for the discount and shift-correction
 * workflows. The server assigns tenant ids in order, so the secondary tenant
 * must be tenant 2; that id is asserted rather than assumed.
 */
export default async function setup() {
  const result = spawnSync('node', ['scripts/local-seed.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, PIROT_LOCAL_URL: base },
  });
  if (result.status !== 0) throw new Error('Synthetic local browser fixture setup failed');

  const login = async (username: string, password: string) => {
    const response = await fetch(`${base}/api/authenticate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (response.status !== 200) throw new Error(`Synthetic login failed for ${username}: ${response.status}`);
    return ((await response.json()) as { id_token: string }).id_token;
  };
  const asAdmin = (bearer: string, path: string, method: string, data: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(data),
    });

  const token = await login(DEVELOPER.username, DEVELOPER.password);

  const created = await asAdmin(token, '/api/tenants', 'POST', { tenantName: 'Synthetic secondary cooperative' });
  if (!created.ok) throw new Error(`Synthetic secondary cooperative setup failed: ${created.status} ${await created.text()}`);
  const tenant = (await created.json()) as { id: number };
  if (tenant.id !== 2) throw new Error(`Expected the secondary cooperative to be tenant 2, received ${tenant.id}`);

  // The discount ceiling is cooperative configuration rather than a hardcoded id,
  // so the secondary tenant needs its own administrator who opts the allowance in.
  const registered = await asAdmin(token, '/api/admin/users', 'POST', {
    login: 'secondary-admin',
    email: 'secondary-admin@example.invalid',
    password: SECONDARY_PASSWORD,
    tenantId: tenant.id,
    activated: true,
    authorities: ['ROLE_ADMIN', 'ROLE_USER'],
  });
  if (!registered.ok) throw new Error(`Secondary administrator setup failed: ${registered.status} ${await registered.text()}`);

  const secondaryToken = await login('secondary-admin', SECONDARY_PASSWORD);
  const settings = await asAdmin(secondaryToken, '/api/cooperative-settings', 'PUT', {
    stockReportEmail: '',
    stockReportEnabled: false,
    maxDiscountPercent: 100,
  });
  if (!settings.ok) throw new Error(`Secondary cooperative discount setting failed: ${settings.status} ${await settings.text()}`);

  await warmClient();

  console.log('Synthetic browser fixtures ready, including tenant 2 for discount and shift-correction workflows.');
}
