const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} from ${req.connection.remoteAddress}`);
    
    let filePath = req.url === '/' ? '/client/index.html' : req.url;
    if (filePath === '/client' || filePath === '/client/') filePath = '/client/index.html';
    if (filePath === '/projection' || filePath === '/projection/') filePath = '/projection/index.html';
    
    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath);
    const contentType = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.mp4' ? 'video/mp4' : 'text/html';
    
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            console.log(`404 - File not found: ${fullPath}`);
            res.writeHead(404);
            res.end('Not found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        }
    });
});

const wss = new WebSocket.Server({ server });
let nextClientId = 1;
const currentPaths = new Map(); // clientId -> points[]
const completedPaths = []; // Array of finished paths used for history

wss.on('connection', (ws, req) => {
    const clientId = nextClientId++;
    const clientIP = req.connection.remoteAddress;
    currentPaths.set(clientId, []);
    console.log(`\n=== WebSocket Connection ===`);
    console.log(`Client ${clientId} connected from ${clientIP}`);
    console.log(`Total clients: ${wss.clients.size}`);
    console.log(`============================\n`);

    // Send drawing history to the new client
    ws.send(JSON.stringify({ type: 'history', paths: completedPaths }));

    ws.on('message', rawMessage => {
        let data;
        try {
            data = JSON.parse(rawMessage);
        } catch (err) {
            console.error('Invalid message, ignoring:', err.message);
            return;
        }

        if (!data || typeof data.type !== 'string') return;

        switch (data.type) {
            case 'draw': {
                if (!data.point || typeof data.point.x !== 'number' || typeof data.point.y !== 'number') {
                    return;
                }
                const existingPath = currentPaths.get(clientId) || [];
                existingPath.push({ x: data.point.x, y: data.point.y });
                currentPaths.set(clientId, existingPath);
                broadcast(ws, { type: 'draw', clientId, point: data.point });
                break;
            }
            case 'endPath': {
                finalizePath(clientId, ws);
                break;
            }
            case 'clear': {
                completedPaths.length = 0;
                currentPaths.forEach((_, id) => currentPaths.set(id, []));
                broadcast(ws, { type: 'clear', clientId });
                break;
            }
            default:
                break;
        }
    });

    ws.on('close', () => {
        finalizePath(clientId, null);
        currentPaths.delete(clientId);
        console.log(`Client ${clientId} disconnected (${wss.clients.size} total)`);
    });
});

function finalizePath(clientId, ws) {
    const path = currentPaths.get(clientId);
    if (path && path.length) {
        const frozenPath = path.map(point => ({ x: point.x, y: point.y }));
        completedPaths.push(frozenPath);
        currentPaths.set(clientId, []);
        broadcast(ws, { type: 'endPath', clientId, path: frozenPath });
    } else {
        broadcast(ws, { type: 'endPath', clientId });
    }
}

function broadcast(sender, data) {
    const payload = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 Constellation Creator Server Started');
    console.log('==========================================');
    console.log(`Server running on: http://0.0.0.0:${PORT}`);
    console.log(`Local access: http://localhost:${PORT}`);
    console.log('------------------------------------------');
    console.log(`📱 Client: http://localhost:${PORT}/client`);
    console.log(`💻 Projection: http://localhost:${PORT}/projection`);
    console.log('==========================================\n');
});
