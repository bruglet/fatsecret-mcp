import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestToken, accessToken } from '../src/oauth1.js';

const credentials = { consumerKey: 'test-key', consumerSecret: 'test-secret' };

test('OAuth flow failures redact upstream response bodies and signed URLs', async () => {
  for (const fetcher of [
    async () => new Response('oauth_token=SECRET', { status: 403 }),
    async () => new Response('oauth_token=SECRET'),
    async () => { throw new Error('https://example.test/?oauth_signature=SECRET'); },
  ] as typeof globalThis.fetch[]) {
    for (const operation of [() => requestToken(credentials, fetcher), () => accessToken(credentials, 'request', 'secret', 'verifier', fetcher)]) {
      await assert.rejects(operation(), (error: Error) => !error.message.includes('SECRET'));
    }
  }
});

test('OAuth token exchange preserves valid authorization responses', async () => {
  const fetcher = async () => new Response('oauth_token=test-token&oauth_token_secret=test-token-secret');
  const request = await requestToken(credentials, fetcher);
  assert.equal(request.oauthToken, 'test-token');
  assert.equal(request.oauthTokenSecret, 'test-token-secret');
  assert.equal(request.authorizationUrl, 'https://authentication.fatsecret.com/oauth/authorize?oauth_token=test-token');
  const access = await accessToken(credentials, 'request', 'secret', 'verifier', fetcher);
  assert.equal(access.accessToken, 'test-token');
  assert.equal(access.accessTokenSecret, 'test-token-secret');
});
