const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readSection } = require('./support/source.cjs');

const testRoot = __dirname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const port = Number(process.env.PORT || 8765);
const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/subject/') && pathname.endsWith('.js')) {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(readSection(pathname.slice('/subject/'.length, -3)));
      return;
    }
    const relative = pathname === '/' ? 'support/browser/index.html' : decodeURIComponent(pathname.slice(1));
    const file = path.resolve(testRoot, relative);
    if (!file.startsWith(testRoot + path.sep) || !types[path.extname(file)]) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await fs.readFile(file);
    response.setHeader('Content-Type', types[path.extname(file)] + '; charset=utf-8');
    response.end(content);
  } catch (error) {
    const missing = error.code === 'ENOENT' || error.code === 'EISDIR';
    response.writeHead(missing ? 404 : 500).end(missing ? 'Not found' : error.message);
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`Open http://127.0.0.1:${server.address().port}/ and keep the tab active. Ctrl+C stops the server.`);
});
