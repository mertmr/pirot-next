// @vitest-environment happy-dom
import { test, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import axios, { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import setupInterceptors from '../src/client/config/axios-interceptor';
import getStore from '../src/client/config/store';
import authReducer, { authenticate, initialState as authInitialState, login } from '../src/client/shared/reducers/authentication';
import reducer, { createEntity, updateEntity, reset } from '../src/client/entities/satis/satis.reducer';
import type { ISatis, ISatisRequest } from '../src/client/shared/model/satis.model';
import { formatDecimal } from '../src/client/shared/util/decimal-format';
test('formats decimal strings exactly without losing cents above 2^53', () => {
  expect(formatDecimal('9007199254740993.25', 2, 'en-US')).toBe('9,007,199,254,740,993.25');
  expect(formatDecimal('-0.25', 2, 'tr-TR')).toBe('-0,25');
});
test('request interceptor preserves an explicit retry key regardless of header casing and attaches authoritative session credentials', async () => {
  const original = axios.defaults.adapter,
    captured: InternalAxiosRequestConfig[] = [];
  axios.defaults.adapter = async config => {
    captured.push(config);
    return { data: {}, status: 200, statusText: 'OK', config, headers: new AxiosHeaders() };
  };
  const browser = new Window({ url: 'https://fixture.test' });
  vi.stubGlobal('window', browser);
  browser.sessionStorage.setItem('koop-authenticationToken', JSON.stringify('synthetic-session-token'));
  browser.sessionStorage.setItem('locale', JSON.stringify('en'));
  const unauthenticated = vi.fn();
  setupInterceptors(unauthenticated);
  try {
    await axios.post('/api/satis', {}, { headers: { 'idempotency-key': 'stable-fixture-key' } });
    await axios.post('/api/satis', {});
    await axios.get('/api/satis');
    expect(captured[0].headers.get('idempotency-key')).toBe('stable-fixture-key');
    expect(captured[0].headers.get('authorization')).toBe('Bearer synthetic-session-token');
    expect(captured[0].headers.get('accept-language')).toBe('en');
    expect(captured[1].headers.get('idempotency-key')).toMatch(/^[a-f0-9-]{36}$/);
    expect(captured[2].headers.has('idempotency-key')).toBe(false);
  } finally {
    axios.interceptors.request.clear();
    axios.interceptors.response.clear();
    axios.defaults.adapter = original;
    browser.sessionStorage.clear();
    vi.unstubAllGlobals();
  }
});
test('failed financial save retains the loaded entity, exposes failure, and clears pending state', () => {
  const request: ISatisRequest = { id: 12, stokHareketleriLists: [{ urunId: 1, miktar: 2 }] };
  const response: AxiosResponse<ISatis> = {
    data: { id: 12, toplamTutar: '9007199254740993.25' },
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  const loaded = reducer(undefined, createEntity.fulfilled(response, 'fixture', request));
  expect(loaded.entity.toplamTutar).toBe('9007199254740993.25');
  const pending = reducer(loaded, updateEntity.pending('fixture', request));
  expect(pending.updating).toBe(true);
  expect(pending.updateSuccess).toBe(false);
  const failed = reducer(pending, updateEntity.rejected(new Error('Insufficient stock'), 'fixture', request));
  expect(failed.updating).toBe(false);
  expect(failed.entity).toEqual(loaded.entity);
  expect(failed.errorMessage).toBe('Insufficient stock');
  expect(failed.updateSuccess).toBe(false);
  expect(reducer(failed, reset()).entity.id).toBeUndefined();
});

test('checkout preserves exact large prices, gram arithmetic and quarter rounding', async () => {
  const { calculateSaleLine, quarterMoney, SaleDecimal } = await import('../src/client/entities/satis/satis-totals');
  expect(calculateSaleLine({ musteriFiyati: '9007199254740993.25', birim: 'ADET' }, 1)).toBe('9007199254740993.25');
  expect(calculateSaleLine({ musteriFiyati: '12.50', birim: 'GRAM' }, 100)).toBe('1.25');
  expect(calculateSaleLine({ musteriFiyati: '1.125', birim: 'ADET' }, 1)).toBe('1.25');
  expect(quarterMoney(new SaleDecimal('100.25').times(new SaleDecimal(100).minus('10')).div(100))).toBe('90.25');
});

const authArgs = { username: 'fixture-user', password: 'fixture-password' };

test('login distinguishes an unreachable server from rejected credentials', () => {
  const offline = authReducer(
    authInitialState,
    authenticate.rejected(new AxiosError('Network Error', 'ERR_NETWORK'), 'fixture-request', authArgs),
  );
  expect(offline.loginError).toBe(true);
  expect(offline.loginUnreachable).toBe(true);
  const deniedResponse: AxiosResponse = {
    data: {},
    status: 401,
    statusText: 'Unauthorized',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  const denied = authReducer(
    authInitialState,
    authenticate.rejected(
      new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', deniedResponse.config, undefined, deniedResponse),
      'fixture-request',
      authArgs,
    ),
  );
  expect(denied.loginError).toBe(true);
  expect(denied.loginUnreachable).toBe(false);
});

test('login resets the unreachable flag on retry and success', () => {
  const stale = { ...authInitialState, loginError: true, loginUnreachable: true };
  expect(authReducer(stale, authenticate.pending('fixture-request', authArgs)).loginUnreachable).toBe(false);
  const successResponse: AxiosResponse<{ id_token: string }> = {
    data: { id_token: 'fixture-jwt' },
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  const success = authReducer(stale, authenticate.fulfilled(successResponse, 'fixture-request', authArgs));
  expect(success.loginUnreachable).toBe(false);
  expect(success.loginSuccess).toBe(true);
});

test('failed login clears a previous users stored credential without probing the account endpoint', async () => {
  const store = getStore();
  const browser = new Window({ url: 'https://fixture.test' });
  vi.stubGlobal('window', browser);
  browser.sessionStorage.setItem('koop-authenticationToken', JSON.stringify('stale-token'));
  const original = axios.defaults.adapter,
    requested: Array<string | undefined> = [];
  axios.defaults.adapter = async config => {
    requested.push(config.url);
    throw new AxiosError('Network Error', 'ERR_NETWORK', config);
  };
  try {
    await store.dispatch(login('someone-else', 'wrong-password'));
  } finally {
    axios.defaults.adapter = original;
    vi.unstubAllGlobals();
  }
  expect(requested).toEqual(['api/authenticate']);
  expect(browser.sessionStorage.getItem('koop-authenticationToken')).toBeNull();
  expect(browser.localStorage.getItem('koop-authenticationToken')).toBeNull();
});

test('successful login stores the fresh token and fetches the session', async () => {
  const store = getStore();
  const browser = new Window({ url: 'https://fixture.test' });
  vi.stubGlobal('window', browser);
  const original = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    if (config.url === 'api/authenticate') {
      const headers = new AxiosHeaders();
      headers.set('authorization', 'Bearer fresh-jwt');
      return { data: { id_token: 'fresh-jwt' }, status: 200, statusText: 'OK', config, headers };
    }
    return { data: { login: 'someone-else', activated: true }, status: 200, statusText: 'OK', config, headers: new AxiosHeaders() };
  };
  try {
    await store.dispatch(login('someone-else', 'correct-password'));
  } finally {
    axios.defaults.adapter = original;
    vi.unstubAllGlobals();
  }
  expect(JSON.parse(browser.sessionStorage.getItem('koop-authenticationToken') ?? 'null')).toBe('fresh-jwt');
  expect(store.getState().authentication.isAuthenticated).toBe(true);
});
