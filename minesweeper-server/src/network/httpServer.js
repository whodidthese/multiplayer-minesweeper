// minesweeper-server/src/network/httpServer.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger'); // Basic logger

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public'); // Navigate up from src/network to root/public

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    // Add other types as needed
};

function initializeHttpServer() {
    const server = http.createServer((req, res) => {
        // Simple security: prevent directory traversal
        if (req.url.includes('..')) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad Request');
            return;
        }

        // Determine file path, default to index.html
        let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
        const extname = String(path.extname(filePath)).toLowerCase();
        const contentType = MIME_TYPES[extname] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    // File not found, try serving index.html for SPA routing (optional)
                    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, content2) => {
                         if (err2) {
                             logger.warn(`404 Not Found: ${req.url} (and index.html not found)`);
                             res.writeHead(404, { 'Content-Type': 'text/plain' });
                             res.end('404 Not Found');
                         } else {
                             // Serve index.html for potential client-side routing
                             res.writeHead(200, { 'Content-Type': 'text/html' });
                             res.end(content2, 'utf-8');
                             logger.info(`Serving index.html for ${req.url}`);
                         }
                    });
                } else {
                    logger.error(`Server Error reading file ${filePath}: ${error.code}`);
                    res.writeHead(500);
                    res.end(`Sorry, check with the site admin for error: ${error.code} ..\n`);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
                // logger.info(`Served: ${req.url}`); // Can be noisy, enable if needed
            }
        });
    });

    return server;
}

module.exports = initializeHttpServer;