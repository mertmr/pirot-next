import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import { DEVELOPER_PASSWORD, DEVELOPER_USERNAME, apiUrl, ensureE2EFixtures, getBootstrapSecret } from './support';

const bootstrapSecret = getBootstrapSecret();

test.setup('developer session', { sessions: ['developer'] }, async ({ app, screen, session, browser }) => {
  if (!app.baseUrl) throw new Error('E2E app base URL is unavailable');

  const developer = credentials.user('developer');
  const response = await fetch(apiUrl(app.baseUrl, '/api/internal/bootstrap'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bootstrap-secret': bootstrapSecret },
    body: JSON.stringify({
      login: developer.username,
      email: 'developer@example.invalid',
      password: DEVELOPER_PASSWORD,
      tenantId: 1,
      tenantName: 'Local synthetic cooperative',
    }),
  });

  if (!response.ok && response.status !== 409) throw new Error(`Bootstrap failed: ${response.status} ${await response.text()}`);
  if (response.ok && (response.headers.get('content-type') ?? '').includes('text/html'))
    throw new Error('Bootstrap returned HTML; the API path did not reach the server');

  const loginResponse = await fetch(apiUrl(app.baseUrl, '/api/authenticate'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: DEVELOPER_USERNAME, password: DEVELOPER_PASSWORD }),
  });
  if (!loginResponse.ok) throw new Error(`Synthetic login failed: ${loginResponse.status} ${await loginResponse.text()}`);
  const { id_token: token } = (await loginResponse.json()) as { id_token: string };
  await ensureE2EFixtures(app.baseUrl, token);

  await app.open('/login');
  await screen.getByTestId('username').fill(developer.username);
  await screen.getByTestId('password').fill(developer.password);
  await screen.getByTestId('submit').tap();
  await expect(screen.getByTestId('entity')).toBeVisible();
  // The app keeps its JWT in session storage, which Playwright storage state
  // (and therefore session save/restore) does not capture. Mirror the token
  // into local storage, which the auth interceptor reads first, so dependent
  // tests restore authenticated. Same approach as tests/browser/helpers.ts.
  await browser.evaluate((jwt: string) => {
    localStorage.setItem('koop-authenticationToken', JSON.stringify(jwt));
    return true;
  }, token);
  await session.save('developer');
});
