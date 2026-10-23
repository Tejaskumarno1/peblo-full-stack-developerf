/*
 * Peblo MCP server, local copy (PEB-95): lets Claude Desktop, Cursor and other MCP clients read and write your notes and tasks.
 *
 *   PEBLO_URL    where Peblo's server runs, e.g. http://localhost:4000 or your hosted address
 *   PEBLO_TOKEN  a personal access token made in Settings (starts with pbl_)
 *
 * The hosted server also offers the same tools at <address>/mcp, with a normal "Connect" sign-in (OAuth): no token to copy.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPebloMcp } from './tools.js';

const BASE = (process.env.PEBLO_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.PEBLO_TOKEN || '';
if (!BASE || !TOKEN) {
  console.error('Set PEBLO_URL (for example http://localhost:4000) and PEBLO_TOKEN (made in Peblo: Settings > Data > Access tokens).');
  process.exit(1);
}

await createPebloMcp(BASE, TOKEN).connect(new StdioServerTransport());