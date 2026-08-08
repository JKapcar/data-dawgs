#!/usr/bin/env node
/* Build data/index.json from every JSON and Markdown file currently in data/. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function digest(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Git stores the Markdown mirrors with LF and GitHub Pages serves those committed
// bytes. A Windows checkout may expose CRLF locally, so canonicalize before
// recording the served byte count and digest.
function servedText(text) {
  return text.replace(/\r\n/g, '\n');
}

function writeDataManifest({ built = new Date().toISOString().slice(0, 10) } = {}) {
  let previous = { data: { files: [], markdown: [] } };
  try { previous = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8')); } catch (_) {}
  const orderedNames = (actual, entries) => {
    const available = new Set(actual);
    const ordered = entries.map(entry => path.basename(entry.path)).filter(name => available.delete(name));
    return ordered.concat([...available].sort());
  };
  const jsonNames = orderedNames(
    fs.readdirSync(DATA).filter(name => name.endsWith('.json') && name !== 'index.json'),
    previous.data.files || []
  );
  const files = jsonNames.map(name => {
    const text = fs.readFileSync(path.join(DATA, name), 'utf8');
    const payload = JSON.parse(text);
    if (!payload.as_of || !payload.source) throw new Error(`${name}: missing as_of or source`);
    return {
      path: '/data/' + name,
      url: 'https://datadawgs216.com/data/' + name,
      bytes: Buffer.byteLength(text),
      as_of: payload.as_of,
      sha256: digest(text),
      note: payload.note,
    };
  });
  const markdown = orderedNames(
    fs.readdirSync(DATA).filter(name => name.endsWith('.md')),
    previous.data.markdown || []
  )
    .map(name => {
      const text = servedText(fs.readFileSync(path.join(DATA, name), 'utf8'));
      const head = text.slice(0, 900);
      const asOf = (head.match(/^as_of:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/m) || [])[1];
      if (!asOf || !/^source:\s*\S/m.test(head)) throw new Error(`${name}: missing as_of or source front matter`);
      return {
        path: '/data/' + name,
        url: 'https://datadawgs216.com/data/' + name,
        bytes: Buffer.byteLength(text),
        sha256: digest(text),
        as_of: asOf,
      };
    });
  const manifest = {
    as_of: built,
    source: 'Generated manifest of every machine-readable surface on datadawgs216.com.',
    note: 'Start here. Each entry carries its own as_of — check it before quoting anything. The sha256 is of the file as served; recompute it if you care.',
    site: 'https://datadawgs216.com',
    built,
    data: { files, markdown },
  };
  const text = JSON.stringify(manifest, null, 1);
  fs.writeFileSync(path.join(DATA, 'index.json'), text);
  return { manifest, bytes: Buffer.byteLength(text) };
}

if (require.main === module) {
  const result = writeDataManifest({ built: process.env.DD_BUILD_DATE });
  console.log(`index.json ${(result.bytes / 1024).toFixed(1)} KB, ${result.manifest.data.files.length} JSON + ${result.manifest.data.markdown.length} Markdown`);
}

module.exports = { writeDataManifest };
