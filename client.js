const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');

const completedPaths = [];
const remoteActivePaths = new Map(); // clientId -> [points]
let localPath = [];
let drawing = false;
const pendingMessages = [];

resizeCanvas();

// Connect to server
const socketHost = window.location.hostname || 'localhost';
let socket;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

function connectWebSocket() {
    socket = new WebSocket(`ws://${socketHost}:8080`);
    
    socket.addEventListener('open', () => {
        console.log('Connected to server');
        reconnectAttempts = 0;
        flushPending();
    });
    
    socket.addEventListener('close', () => {
        console.warn('Connection closed');
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`Reconnecting... attempt ${reconnectAttempts}`);
            setTimeout(connectWebSocket, 2000);
        }
    });
    
    socket.addEventListener('error', err => {
        console.error('Socket error', err);
    });
    
    socket.addEventListener('message', event => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (err) {
            console.error('Bad message', err);
            return;
        }
        if (!data || typeof data.type !== 'string') return;

        switch (data.type) {
            case 'history':
                completedPaths.length = 0;
                if (Array.isArray(data.paths)) {
                    data.paths.forEach(path => {
                        if (Array.isArray(path) && path.length) {
                            completedPaths.push(path.map(point => ({ x: point.x, y: point.y })));
                        }
                    });
                }
                render();
                break;
            case 'draw':
                if (!data.point || typeof data.clientId === 'undefined') break;
                addPointToRemotePath(data.clientId, data.point);
                break;
            case 'endPath':
                if (typeof data.clientId === 'undefined') break;
                finalizeRemotePath(data.clientId, data.path);
                break;
            case 'clear':
                completedPaths.length = 0;
                remoteActivePaths.clear();
                render();
                break;
            default:
                break;
        }
    });
}

connectWebSocket();



function addPointToRemotePath(clientId, point) {
    if (typeof point.x !== 'number' || typeof point.y !== 'number') return;
    const path = remoteActivePaths.get(clientId) || [];
    path.push({ x: point.x, y: point.y });
    remoteActivePaths.set(clientId, path);
    render();
}

function finalizeRemotePath(clientId, suppliedPath) {
    const path = suppliedPath && suppliedPath.length
        ? suppliedPath.map(point => ({ x: point.x, y: point.y }))
        : remoteActivePaths.get(clientId);

    if (path && path.length) {
        completedPaths.push(path);
    }
    remoteActivePaths.delete(clientId);
    render();
}

function sendMessage(payload) {
    const serialized = JSON.stringify(payload);
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(serialized);
    } else {
        pendingMessages.push(serialized);
    }
}

function flushPending() {
    while (pendingMessages.length && socket.readyState === WebSocket.OPEN) {
        socket.send(pendingMessages.shift());
    }
}

function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) {
        return {
            x: e.touches[0].clientX - rect.left,
            y: e.touches[0].clientY - rect.top
        };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function handlePointerStart(e) {
    drawing = true;
    localPath = [getPos(e)];
    render();
    sendMessage({ type: 'draw', point: localPath[0] });
}

function handlePointerMove(e) {
    if (!drawing) return;
    const point = getPos(e);
    localPath.push(point);
    render();
    sendMessage({ type: 'draw', point });
}

function handlePointerEnd() {
    if (!drawing) return;
    drawing = false;
    if (localPath.length) {
        completedPaths.push(localPath.map(point => ({ x: point.x, y: point.y })));
        render();
        sendMessage({ type: 'endPath' });
        localPath = [];
    }
}

canvas.addEventListener('mousedown', handlePointerStart);
canvas.addEventListener('mousemove', handlePointerMove);
canvas.addEventListener('mouseup', handlePointerEnd);
canvas.addEventListener('mouseleave', handlePointerEnd);

canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    handlePointerStart(e);
}, { passive: false });
canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    handlePointerMove(e);
}, { passive: false });
canvas.addEventListener('touchend', () => {
    handlePointerEnd();
}, { passive: false });
canvas.addEventListener('touchcancel', handlePointerEnd, { passive: false });

window.addEventListener('resize', resizeCanvas);

document.getElementById('clearBtn').addEventListener('click', () => {
    completedPaths.length = 0;
    remoteActivePaths.clear();
    localPath = [];
    render();
    sendMessage({ type: 'clear' });
});

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    render();
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    completedPaths.forEach(drawPath);
    remoteActivePaths.forEach(drawPath);
    if (localPath.length) drawPath(localPath);
}

function drawPath(points) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = 'cyan';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
}
