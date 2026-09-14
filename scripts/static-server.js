/**
 * 開發期靜態伺服器：把 bin-debug/ 端出來給瀏覽器跑。
 *
 * 只在本機開發用，不參與建置。Egret Launcher 已停止服務，
 * 這是最小替代品 —— 不做快取、不做壓縮、不監看檔案。
 *
 *   node scripts/static-server.js        → http://localhost:5321
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'bin-debug');
const PORT = Number(process.env.PORT || 5321);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.fnt': 'text/plain; charset=utf-8',
    '.exml': 'text/xml; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const target = path.resolve(ROOT, relative);

    if (!target.startsWith(ROOT)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.readFile(target, (err, data) => {
        if (err) {
            console.log('404 ' + urlPath);
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found: ' + urlPath);
            return;
        }

        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log('static server: http://localhost:' + PORT + '  root=' + ROOT);
});
