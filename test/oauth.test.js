import test from 'node:test';
import assert from 'node:assert/strict';
import { createPkce, parseResourceMetadataUrl, successPage, wellKnownUrl } from '../src/oauth.js';

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

test('renders a branded success page without external assets', async () => {
  const page = await successPage();
  assert.match(page, /Autentique MCP Connector/);
  assert.match(page, /painel\.autentique\.com\.br\/perfil\/api/);
  assert.match(page, /<svg[^>]*width="37"[^>]*height="36"/);
  assert.doesNotMatch(page, /\{\{AUTENTIQUE_LOGO\}\}/);
  assert.doesNotMatch(page, /<img\b/);
});
