import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname } from 'node:path';
import os from 'node:os';

const DIST_DIR = join(process.cwd(), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

function randomPort(min = 3000, max = 8999) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getLanIPs() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let filePath;
    if (url.pathname === '/' || url.pathname === '') {
      filePath = join(DIST_DIR, 'index.html');
    } else {
      filePath = join(DIST_DIR, decodeURIComponent(url.pathname.replace(/^\/+/, '')));
    }

    try {
      const st = await stat(filePath);
      if (st.isDirectory()) {
        // prevent directory listing; try index.html within
        filePath = join(filePath, 'index.html');
      }
    } catch {
      // not found
    }

    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    const rs = createReadStream(filePath);
    rs.on('error', async () => {
      // fallback: for unknown routes, serve homepage
      try {
        const html = await readFile(join(DIST_DIR, 'index.html'));
        res.setHeader('Content-Type', MIME['.html']);
        res.writeHead(200);
        res.end(html);
      } catch (e) {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    rs.pipe(res);
  } catch (err) {
    res.writeHead(500);
    res.end('Server Error');
  }
});

const port = randomPort();
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Serving dist on:\n  - http://localhost:${port}`);
  const ips = getLanIPs();
  if (ips.length) {
    for (const ip of ips) {
      // eslint-disable-next-line no-console
      console.log(`  - http://${ip}:${port}`);
    }
  }
});


