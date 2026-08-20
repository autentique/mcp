# @autentique/mcp

Autentique's local stdio MCP client. It connects MCP desktop clients to the
Autentique Streamable HTTP server and handles OAuth locally, including
protected-resource discovery, dynamic client registration, PKCE, browser
authorization, token refresh, and token persistence.

This package is a transport client, not a second implementation of the
Autentique tools. Tools and authorization policy remain on the Autentique API.

## Configuration

```json
{
  "mcpServers": {
    "autentique": {
      "command": "npx",
      "args": ["-y", "@autentique/mcp"]
    }
  }
}
```

The default endpoint is `https://api.autentique.com.br/mcp`. Override it with
`AUTENTIQUE_MCP_URL` when testing another environment. OAuth credentials are
stored in the platform config directory and can be removed with:

```bash
npx -y @autentique/mcp --reset-auth
```

Use `AUTENTIQUE_MCP_TOKEN_PATH` to relocate the token file. It is written with
mode `0600`. Set `AUTENTIQUE_MCP_CLIENT_NAME` to customize the application name
shown on the OAuth consent screen.

## Development

```bash
npm test
node src/index.js
```

The process speaks newline-delimited JSON-RPC on stdin/stdout. Diagnostics go
to stderr so they never corrupt MCP framing.
