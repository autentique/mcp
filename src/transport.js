import { OAuthClient } from './oauth.js';
import { writeMessage } from './stdio.js';

function errorResponse(message, request) {
  if (request.id === undefined) return;
  writeMessage({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message } });
}

async function bodyMessages(response) {
  const body = await response.text();
  if (!body.trim()) return [];
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) return [JSON.parse(body)];
  return body
    .split(/\r?\n\r?\n/)
    .flatMap((event) => event.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .map((data) => JSON.parse(data)));
}

export class McpTransport {
  constructor(resourceUrl) {
    this.resourceUrl = resourceUrl;
    this.oauth = new OAuthClient(resourceUrl);
    this.sessionId = null;
    this.protocolVersion = null;
  }

  async send(request) {
    let token = await this.oauth.accessToken();
    let response = await this.post(request, token);
    if (response.status === 401) {
      token = await this.oauth.authenticate(response.headers.get('www-authenticate'));
      response = await this.post(request, token);
    }
    if (!response.ok) {
      errorResponse(`MCP server returned HTTP ${response.status}.`, request);
      return;
    }
    for (const message of await bodyMessages(response)) {
      if (request.method === 'initialize' && message.result?.protocolVersion) {
        this.protocolVersion = message.result.protocolVersion;
      }
      writeMessage(message);
    }
  }

  async post(request, token) {
    const headers = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion;
    const response = await fetch(this.resourceUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.sessionId = sessionId;
    return response;
  }
}
