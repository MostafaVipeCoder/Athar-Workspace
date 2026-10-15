// Test-only configuration. Every value here is a made-up string for the fake Google server: none of it is a real credential.
import { getGoogleConfig } from '../../google-core.js'

export const TEST_CLIENT_ID = 'test-client-id.apps.fake-google.invalid'
export const TEST_CLIENT_SECRET = 'test-client-secret-not-a-real-secret'
export const TEST_STATE_SECRET = 'unit-test-state-secret-0123456789-abcdefghijklmnop'
export const TEST_ENC_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
export const TEST_ENC_KEY_2 = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100'

export const REDIRECT_URI = 'http://127.0.0.1:54321/functions/v1/google-oauth-callback'
export const APP_URL = 'http://127.0.0.1:5602'

export function makeEnv(fake, extra = {}) {
  return {
    GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: TEST_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: REDIRECT_URI,
    APP_URL,
    OAUTH_STATE_SECRET: TEST_STATE_SECRET,
    TOKEN_ENC_KEY: TEST_ENC_KEY,
    ALLOW_FAKE_GOOGLE: '1',
    ...(fake ? { GOOGLE_AUTH_BASE: fake.url, GOOGLE_TOKEN_URL: `${fake.url}/token`, GOOGLE_API_BASE: fake.url } : {}),
    ...extra,
  }
}

export const makeConfig = (fake, extra = {}) => getGoogleConfig(makeEnv(fake, extra))

/** Follow the authorize URL the way a browser would, WITHOUT following the final redirect to the app: -> the callback URL (string). */
export async function authorize(url) {
  const res = await fetch(url, { redirect: 'manual' })
  if (res.status !== 302) throw new Error(`authorize answered ${res.status}`)
  return res.headers.get('location')
}

export const USERS = {
  pm: { id: '11111111-1111-4111-8111-111111111111', email: 'pm.one@athareg.com', roles: ['project_manager'] },
  pm2: { id: '22222222-2222-4222-8222-222222222222', email: 'pm.two@athareg.com', roles: ['project_manager'] },
  admin: { id: '33333333-3333-4333-8333-333333333333', email: 'admin@athareg.com', roles: ['super_admin'] },
  founder: { id: '44444444-4444-4444-8444-444444444444', email: 'founder@example.invalid', roles: ['founder'] },
}
export const usersById = () => Object.fromEntries(Object.values(USERS).map((u) => [u.id, { email: u.email, roles: u.roles }]))
