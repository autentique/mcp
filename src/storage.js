import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export function tokenStorePath() {
  if (process.env.AUTENTIQUE_MCP_TOKEN_PATH) return process.env.AUTENTIQUE_MCP_TOKEN_PATH;
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Autentique', 'mcp-oauth.json');
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autentique', 'mcp-oauth.json');
}

export async function readToken(resourceUrl) {
  try {
    const tokens = JSON.parse(await readFile(tokenStorePath(), 'utf8'));
    return tokens[resourceUrl] || null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeToken(resourceUrl, token) {
  const path = tokenStorePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let tokens = {};
  try {
    tokens = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  tokens[resourceUrl] = token;
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

export async function removeToken(resourceUrl) {
  const path = tokenStorePath();
  try {
    const tokens = JSON.parse(await readFile(path, 'utf8'));
    delete tokens[resourceUrl];
    await writeFile(path, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(path, 0o600);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
