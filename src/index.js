#!/usr/bin/env node

import { removeToken } from './storage.js';
import { readMessages } from './stdio.js';
import { McpTransport } from './transport.js';

const DEFAULT_RESOURCE_URL = 'https://api.autentique.com.br/mcp';
const resourceUrl = process.env.AUTENTIQUE_MCP_URL || DEFAULT_RESOURCE_URL;

if (process.argv.includes('--reset-auth')) {
  await removeToken(resourceUrl);
  process.stderr.write('[autentique-mcp] OAuth credentials removed.\n');
  process.exit(0);
}

const transport = new McpTransport(resourceUrl);
let queue = Promise.resolve();

await readMessages((message) => {
  queue = queue.then(() => transport.send(message)).catch((error) => {
    process.stderr.write(`[autentique-mcp] ${error.stack || error.message}\n`);
    if (message.id !== undefined) {
      errorResponseFallback(message, error.message);
    }
  });
  return queue;
});

await queue;

function errorResponseFallback(request, message) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    error: { code: -32603, message },
  })}\n`);
}
