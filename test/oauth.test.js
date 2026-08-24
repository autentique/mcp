import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CallbackServer,
  createPkce,
  openBrowser,
  parseResourceMetadataUrl,
  successPage,
  wellKnownUrl,
} from '../src/oauth.js';

test('parses the protected resource metadata URL', () => {
  assert.equal(
    parseResourceMetadataUrl('Bearer resource_metadata="https://api.example/.well-known/oauth-protected-resource/mcp"'),
    'https://api.example/.well-known/oauth-protected-resource/mcp',
  );
  assert.equal(parseResourceMetadataUrl(null), null);
});

test('builds authorization server well-known URLs', () => {
  assert.equal(
    wellKnownUrl('https://api.example', 'oauth-authorization-server').toString(),
    'https://api.example/.well-known/oauth-authorization-server',
  );
});

test('creates a PKCE pair', () => {
  const { verifier, challenge } = createPkce();
  assert.ok(verifier.length >= 43);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
});

test('opens complete OAuth URLs through the platform opener', async () => {
  const authorizationUrl = 'https://api.example/oauth/authorize?client_id=client&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Foauth%2Fcallback&response_type=code&state=state&code_challenge=challenge';
  let openedTarget;
  let completeOpening;

  const opening = openBrowser(authorizationUrl, (target) => {
    openedTarget = target;
    return new Promise((resolve) => {
      completeOpening = resolve;
    });
  });

  assert.equal(openedTarget, authorizationUrl);
  assert.ok(opening instanceof Promise);
  completeOpening();
  await opening;
});

test('closes pending OAuth callback waits', async () => {
  const callback = new CallbackServer();
  const rejection = assert.rejects(
    callback.waitForCode('state'),
    /OAuth callback server closed/,
  );

  callback.close();

  await rejection;
});

test('renders a branded success page without external assets', async () => {
  const page = await successPage();
  assert.match(page, /Autentique MCP Connector/);
  assert.match(page, /painel\.autentique\.com\.br\/perfil\/api/);
  assert.match(page, /<svg[^>]*width="37"[^>]*height="36"/);
  assert.doesNotMatch(page, /\{\{AUTENTIQUE_LOGO\}\}/);
  assert.doesNotMatch(page, /<img\b/);
});
