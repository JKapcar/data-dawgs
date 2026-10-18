const fs = require('fs');
const path = require('path');

// Source counts are not a claim about the authenticated production catalog.
function validateLlms(root, text) {
  const errors = [];
  const block = fs.readFileSync(path.join(root, 'work/mcp-block.js'), 'utf8');
  const registry = block.slice(block.indexOf('const MCP_TOOLS = ['));
  const names = [...registry.matchAll(/\n\s+name: "((?:dd|sd)_\w+)"/g)];
  const entries = [...registry.matchAll(/\n\s+name: "((?:dd|sd)_\w+)",\s+title: "[^"]+",\s+catalog: "(core|full)",\s+readOnlyHint: (true|false),/g)];
  if (!entries.length || entries.length !== names.length || new Set(names.map(m => m[1])).size !== names.length)
    errors.push('MCP source registry is empty, duplicated or incompletely annotated');
  const writes = entries.filter(m => m[3] === 'false').length;
  const claims = [...text.matchAll(/Source MCP: (\d+) tools; (\d+) not read-only/g)];
  if (claims.length !== 1 || +claims[0][1] !== entries.length || +claims[0][2] !== writes)
    errors.push(`Source MCP claim must match ${entries.length} tools; ${writes} not read-only`);
  const bytes = Buffer.byteLength(text.replace(/\r\n/g, '\n'));
  if (bytes > 6 * 1024) errors.push(`llms.txt is ${bytes} bytes; limit is 6144`);
  return { errors, bytes, tools: entries.length, writes };
}
module.exports = { validateLlms };
