import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { readToken, removeToken, writeToken } from './storage.js';

const CALLBACK_PATH = '/oauth/callback';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const successPagePath = join(sourceDirectory, 'oauth-success.html');
const logoPath = join(sourceDirectory, 'autentique-logo.svg');
let successPagePromise;

export function successPage() {
  successPagePromise ??= Promise.all([
    readFile(successPagePath, 'utf8'),
    readFile(logoPath, 'utf8'),
  ]).then(([template, logo]) => template.replaceAll('{{AUTENTIQUE_LOGO}}', logo));
  return successPagePromise;
}

export function parseResourceMetadataUrl(header) {
  return header?.match(/resource_metadata="([^"]+)"/i)?.[1] || null;
}

export function wellKnownUrl(issuer, document) {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/$/, '');
  url.pathname = path ? `/.well-known/${document}${path}` : `/.well-known/${document}`;
  url.search = '';
  url.hash = '';
  return url;
}

export function createPkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function log(message) {
  process.stderr.write(`[autentique-mcp] ${message}\n`);
}

export function openBrowser(url, opener = open) {
  return opener(url);
}

async function jsonResponse(response, context) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${context} returned non-JSON (${response.status}).`);
  }
  if (!response.ok) {
    const detail = payload.error_description || payload.error || payload.message || response.statusText;
    throw new Error(`${context} failed (${response.status}): ${detail}`);
  }
  return payload;
}

export class CallbackServer {
  constructor() {
    this.server = createServer();
    this.pending = null;
  }

  async start() {
    this.server.on('request', async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end('Not found');
        return;
      }
      if (!this.pending) {
        response.writeHead(409).end('No OAuth request is pending.');
        return;
      }
      const { state, resolve, reject } = this.pending;
      this.pending = null;
      if (url.searchParams.get('state') !== state) {
        response.writeHead(400).end('Invalid OAuth state.');
        reject(new Error('OAuth state mismatch.'));
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        response.writeHead(400).end(`OAuth authorization failed: ${error}`);
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('OAuth callback did not contain an authorization code.');
        reject(new Error('OAuth callback did not contain an authorization code.'));
        return;
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer',
      }).end(await successPage());
      resolve(code);
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    return `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
  }

  waitForCode(state) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = null;
        reject(new Error('Timed out waiting for the OAuth callback.'));
      }, AUTH_TIMEOUT_MS);
      this.pending = {
        state,
        resolve: (code) => { clearTimeout(timeout); resolve(code); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      };
    });
  }

  close() {
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = null;
      reject(new Error('OAuth callback server closed.'));
    }
    this.server.close();
  }
}

export class OAuthClient {
  constructor(resourceUrl, fetchImpl = fetch) {
    this.resourceUrl = resourceUrl;
    this.fetch = fetchImpl;
  }

  async accessToken() {
    const token = await readToken(this.resourceUrl);
    if (!token) return null;
    if (!token.expiresAt || token.expiresAt > Date.now() + 60_000) return token.accessToken;
    if (!token.refreshToken) return null;
    try {
      const refreshed = await this.refresh(token);
      return refreshed.accessToken;
    } catch (error) {
      log(`token refresh failed: ${error.message}`);
      await removeToken(this.resourceUrl);
      return null;
    }
  }

  async authenticate(challengeHeader) {
    const existingToken = await readToken(this.resourceUrl);
    if (existingToken?.refreshToken) {
      try {
        const refreshed = await this.refresh(existingToken);
        return refreshed.accessToken;
      } catch (error) {
        log(`token refresh after a 401 failed: ${error.message}`);
        await removeToken(this.resourceUrl);
      }
    }

    const resourceMetadataUrl = parseResourceMetadataUrl(challengeHeader)
      || new URL(`/.well-known/oauth-protected-resource${new URL(this.resourceUrl).pathname}`, this.resourceUrl).toString();
    const resourceMetadata = await jsonResponse(
      await this.fetch(resourceMetadataUrl, { headers: { accept: 'application/json' } }),
      'Protected resource metadata',
    );
    const authorizationServer = resourceMetadata.authorization_servers?.[0];
    if (!authorizationServer) throw new Error('Protected resource metadata did not advertise an authorization server.');
    const authorizationMetadata = await jsonResponse(
      await this.fetch(wellKnownUrl(authorizationServer, 'oauth-authorization-server')),
      'Authorization server metadata',
    );
    const callback = new CallbackServer();
    const redirectUri = await callback.start();
    const state = randomUUID();
    const { verifier, challenge } = createPkce();
    let codePromise;
    try {
      const registration = await jsonResponse(
        await this.fetch(authorizationMetadata.registration_endpoint, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: process.env.AUTENTIQUE_MCP_CLIENT_NAME || 'Autentique MCP Connector',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
        }),
        'OAuth client registration',
      );
      const scopes = process.env.AUTENTIQUE_MCP_SCOPES
        || (resourceMetadata.scopes_supported || []).join(' ')
        || registration.scope
        || '';
      const authorizationUrl = new URL(authorizationMetadata.authorization_endpoint);
      authorizationUrl.search = new URLSearchParams({
        client_id: registration.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      log('opening the Autentique authorization page in your browser');
      codePromise = callback.waitForCode(state);
      await openBrowser(authorizationUrl.toString());
      const code = await codePromise;
      const token = await jsonResponse(
        await this.fetch(authorizationMetadata.token_endpoint, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: registration.client_id,
            redirect_uri: redirectUri,
            code,
            code_verifier: verifier,
          }),
        }),
        'OAuth token exchange',
      );
      await writeToken(this.resourceUrl, {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: token.expires_in ? Date.now() + (Number(token.expires_in) * 1000) : null,
        clientId: registration.client_id,
        redirectUri,
        tokenEndpoint: authorizationMetadata.token_endpoint,
      });
      return token.access_token;
    } finally {
      callback.close();
      await codePromise?.catch(() => {});
    }
  }

  async refresh(token) {
    const response = await this.fetch(token.tokenEndpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: token.clientId,
      }),
    });
    const refreshed = await jsonResponse(response, 'OAuth token refresh');
    const nextToken = {
      ...token,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || token.refreshToken,
      expiresAt: refreshed.expires_in ? Date.now() + (Number(refreshed.expires_in) * 1000) : null,
    };
    await writeToken(this.resourceUrl, nextToken);
    return nextToken;
  }
}
