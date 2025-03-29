// public/js/app.js

// --- Configuration ---
const WS_URL = `ws://${window.location.host}`; // Connect to server host
const MAP_WIDTH = 640; // Must match server config
const MAP_HEIGHT = 640; // Must match server config
const CELL_SIZE = 25; // Visual size of cells in pixels (can be dynamic later)
const PLAYER_CURSOR_COLOR = '#ff0000';
const OTHER_PLAYER_CURSOR_COLOR = '#0000ff';
const LONG_PRESS_DURATION = 500; // ms for long press detection

// --- DOM Elements ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusElement = document.getElementById('status');
const scoreElement = document.getElementById('score');

// --- Game State ---
let ws;
let playerId = null;
let score = 0;
let mapData = {}; // Object mapping "x,y" string to cell state { state, value }
let players = {}; // Object mapping playerId to player state { id, x, y, isSelf }
let viewport = {
    x: 0, // Top-left map X coordinate visible
    y: 0, // Top-left map Y coordinate visible
    // zoom: 1 // Zoom level (implement later)
};
let isPanning = false;
let panStartX = 0, panStartY = 0;
let lastRenderTime = 0;
let longPressTimer = null;

// --- WebSocket Logic ---
function connectWebSocket() {
    statusElement.textContent = 'Connecting...';
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        statusElement.textContent = 'Connected';
        logger.info('WebSocket connected');
        // No need to send playerHello, server assigns ID on connection
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message);
        } catch (error) {
            logger.error('Failed to parse message:', event.data, error);
        }
    };

    ws.onerror = (error) => {
        statusElement.textContent = 'Connection Error';
        logger.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        statusElement.textContent = 'Disconnected. Attempting to reconnect...';
        logger.info('WebSocket closed. Reconnecting...');
        // Simple reconnect logic
        setTimeout(connectWebSocket, 5000);
        // Reset local state on disconnect? Or try to resume? For MVP, reset.
        resetLocalState();
    };
}

function handleWebSocketMessage(message) {
    // logger.debug('Message received:', message); // Can be noisy
    switch (message.type) {
        case 'initialState':
            playerId = message.data.playerId;
            score = message.data.score;
            mapData = {}; // Reset map data
            message.data.mapChunk.cells.forEach(cell => {
                mapData[`${cell.x},${cell.y}`] = { state: cell.state, value: cell.value };
            });
            players = {}; // Reset players
            message.data.players.forEach(p => {
                players[p.id] = { ...p, isSelf: false };
            });
            // Add self (use position from message if available, else default)
             const selfPos = message.data.self || { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
             players[playerId] = { id: playerId, x: selfPos.x, y: selfPos.y, isSelf: true };
             // Center initial viewport on player
             centerViewportOn(selfPos.x, selfPos.y);

            updateUI();
            logger.info('Initial state received.');
            break;

        case 'mapUpdate':
            message.data.cells.forEach(cell => {
                mapData[`${cell.x},${cell.y}`] = { state: cell.state, value: cell.value };
            });
            // No need to updateUI immediately, render loop handles it
            break;

        case 'playerJoined':
            if (message.data.id !== playerId) {
                players[message.data.id] = { ...message.data, isSelf: false };
            }
            break;

        case 'playerLeft':
            delete players[message.data.id];
            break;

        case 'playerPositionUpdate':
            message.data.players.forEach(p => {
                if (players[p.id] && p.id !== playerId) {
                    players[p.id].x = p.x;
                    players[p.id].y = p.y;
                }
            });
            break;

        case 'scoreUpdate':
            score = message.data.score;
            updateUI();
            break;

        case 'playerPenalty':
            score = message.data.score;
            // TODO: Implement visual stun effect?
            logger.warn(`Mine hit! Stunned for ${message.data.stunDurationMs}ms`);
            updateUI();
            break;

        case 'error': // Server-sent error
             logger.error('Server error message:', message.data.message);
             statusElement.textContent = `Server Error: ${message.data.message}`;
             break;

        default:
            logger.warn('Unknown message type received:', message.type);
    }
}

function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        logger.error('WebSocket not open. Cannot send message:', message);
    }
}

function resetLocalState() {
    playerId = null;
    score = 0;
    mapData = {};
    players = {};
    // Reset viewport? Maybe keep last position? For now, reset.
    viewport.x = 0;
    viewport.y = 0;
    updateUI();
}

// --- UI Update ---
function updateUI() {
    scoreElement.textContent = `Score: ${score}`;
    // Update status element handled by WebSocket events mostly
}

// --- Rendering Logic ---
function resizeCanvas() {
    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio); // Adjust scale for HiDPI
}

function centerViewportOn(mapX, mapY) {
    const viewWidthCells = canvas.clientWidth / CELL_SIZE;
    const viewHeightCells = canvas.clientHeight / CELL_SIZE;
    viewport.x = mapX - viewWidthCells / 2;
    viewport.y = mapY - viewHeightCells / 2;
    // Ensure viewport stays within reasonable bounds if needed, though wrapping handles it
}

function drawGame() {
    resizeCanvas(); // Ensure canvas size is up-to-date

    const viewWidth = canvas.clientWidth;
    const viewHeight = canvas.clientHeight;
    const scale = window.devicePixelRatio; // Use scale for drawing

    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear scaled canvas

    // Calculate visible map coordinate range
    const startX = Math.floor(viewport.x);
    const startY = Math.floor(viewport.y);
    const endX = Math.ceil(viewport.x + viewWidth / CELL_SIZE);
    const endY = Math.ceil(viewport.y + viewHeight / CELL_SIZE);

    // --- Draw Cells (with wrapping) ---
    ctx.font = `${Math.floor(CELL_SIZE * 0.6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const mapX = (x + MAP_WIDTH) % MAP_WIDTH; // Handle horizontal wrapping
            const mapY = (y + MAP_HEIGHT) % MAP_HEIGHT; // Handle vertical wrapping

            const cellKey = `${mapX},${mapY}`;
            const cell = mapData[cellKey]; // Get state from local cache

            // Calculate drawing position on canvas
            const drawX = (x - viewport.x) * CELL_SIZE;
            const drawY = (y - viewport.y) * CELL_SIZE;

            // Determine appearance based on state
            let fillStyle = '#bdbdbd'; // Default hidden
            let strokeStyle = '#9e9e9e';
            let text = '';
            let textColor = '#000000';

            if (cell) {
                switch (cell.state) {
                    case 'revealed':
                        fillStyle = '#e0e0e0'; // Revealed background
                        if (cell.value > 0) {
                            text = cell.value.toString();
                            // Colors for numbers (example)
                            const colors = ['#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];
                            textColor = colors[cell.value - 1] || '#000000';
                        }
                        break;
                    case 'flagged':
                        fillStyle = '#bdbdbd';
                        text = '🚩'; // Flag emoji
                        break;
                    case 'mine':
                        fillStyle = '#ffcdd2'; // Exploded mine background
                        text = '💣'; // Bomb emoji
                        break;
                    // 'hidden' is handled by default fillStyle
                }
            }

            // Draw cell rectangle
            ctx.fillStyle = fillStyle;
            ctx.strokeStyle = strokeStyle;
            ctx.fillRect(drawX, drawY, CELL_SIZE, CELL_SIZE);
            ctx.strokeRect(drawX, drawY, CELL_SIZE, CELL_SIZE);

            // Draw text/emoji if any
            if (text) {
                ctx.fillStyle = textColor; // Set text color for numbers
                // Adjust emoji baseline slightly
                const baselineAdjust = (text === '🚩' || text === '💣') ? CELL_SIZE * 0.05 : 0;
                ctx.fillText(text, drawX + CELL_SIZE / 2, drawY + CELL_SIZE / 2 + baselineAdjust);
            }
        }
    }

     // --- Draw Players ---
     ctx.font = `${Math.floor(CELL_SIZE * 0.8)}px sans-serif`; // Slightly larger for cursor maybe
     for (const pId in players) {
         const player = players[pId];

         // Check if player is within the drawable area (consider wrapping)
         // This requires comparing player coords against viewport range carefully
         // Simplified check: is player visually near viewport center?
         // TODO: More robust check needed including visual wrapping display

         // Calculate drawing position relative to viewport
          const drawX = (player.x - viewport.x) * CELL_SIZE + CELL_SIZE / 2; // Center cursor
          const drawY = (player.y - viewport.y) * CELL_SIZE + CELL_SIZE / 2;

          // Simple cursor representation
           ctx.fillStyle = player.isSelf ? PLAYER_CURSOR_COLOR : OTHER_PLAYER_CURSOR_COLOR;
           // Draw a small circle or crosshair
           ctx.beginPath();
           ctx.arc(drawX, drawY, CELL_SIZE * 0.2, 0, Math.PI * 2);
           ctx.fill();
           // Maybe draw player ID text? (can get cluttered)
           // ctx.fillText(player.id.substring(0, 4), drawX, drawY - CELL_SIZE * 0.3);
     }


    // --- Game Loop ---
    requestAnimationFrame(drawGame);
}

// --- Input Handling ---
function screenToMapCoords(screenX, screenY) {
    const mapX = Math.floor(screenX / CELL_SIZE + viewport.x);
    const mapY = Math.floor(screenY / CELL_SIZE + viewport.y);

    // Return wrapped coordinates
    return {
        x: (mapX + MAP_WIDTH) % MAP_WIDTH,
        y: (mapY + MAP_HEIGHT) % MAP_HEIGHT
    };
}

function handleCanvasClick(event) {
    event.preventDefault();
    if (isPanning) return; // Don't click if panning finished on same spot

    // Simple click for reveal
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const coords = screenToMapCoords(screenX, screenY);

    logger.debug(`Click mapped to: (${coords.x}, ${coords.y})`);
    sendMessage({ type: 'clickCell', data: coords });
}

function handleContextMenu(event) {
    event.preventDefault(); // Prevent browser context menu
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const coords = screenToMapCoords(screenX, screenY);

    logger.debug(`Right Click/Long Press mapped to: (${coords.x}, ${coords.y})`);
    sendMessage({ type: 'flagCell', data: coords });
}

function handlePointerDown(event) {
     event.preventDefault();
     isPanning = false; // Reset panning state
     const point = getPoint(event);
     panStartX = point.x;
     panStartY = point.y;

     // Start long press timer for touch
     if (event.pointerType === 'touch') {
         clearTimeout(longPressTimer); // Clear any previous timer
         longPressTimer = setTimeout(() => {
              handleContextMenu({ // Simulate context menu event
                   preventDefault: () => {},
                   clientX: point.clientX, // Use stored client coords
                   clientY: point.clientY
              });
              longPressTimer = null; // Clear timer
              // Prevent click/pan after long press triggers flag
              isPanning = true; // Use isPanning flag to suppress click/move
         }, LONG_PRESS_DURATION);
     }
     canvas.setPointerCapture(event.pointerId); // Capture pointer for dragging
}

function handlePointerMove(event) {
     event.preventDefault();
     if (!event.buttons && event.pointerType !== 'touch') return; // Not dragging mouse / Ignore move if not touch
     if (longPressTimer === null && event.pointerType === 'touch' && isPanning) return; // Don't pan if long press already triggered


     const point = getPoint(event);
     const deltaX = point.x - panStartX;
     const deltaY = point.y - panStartY;


     // If movement detected, clear long press timer and set panning flag
     if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
          if (event.pointerType === 'touch') {
                clearTimeout(longPressTimer);
                longPressTimer = null;
          }
          isPanning = true; // Moved enough to be considered panning
     }

     if(isPanning) {
         // Update viewport based on drag delta (adjust for cell size)
         viewport.x -= deltaX / CELL_SIZE;
         viewport.y -= deltaY / CELL_SIZE;

         // Update start points for next move calculation
         panStartX = point.x;
         panStartY = point.y;
     }

      // Send player position update (throttling needed!)
      // For now, send on every move while dragging (will be too much)
      // TODO: Implement throttling for updatePosition
      // const mapCoords = screenToMapCoords(point.clientX - canvas.getBoundingClientRect().left, point.clientY - canvas.getBoundingClientRect().top);
      // sendMessage({ type: 'updatePosition', data: mapCoords });

}

function handlePointerUp(event) {
     event.preventDefault();
     canvas.releasePointerCapture(event.pointerId);

     if (event.pointerType === 'touch') {
         clearTimeout(longPressTimer); // Clear timer if pointer lifted before duration
         if (longPressTimer !== null && !isPanning) {
              // If timer was active and no panning occurred, treat as tap (click)
               handleCanvasClick({
                   preventDefault: () => {},
                   clientX: event.clientX, // Use final event coords
                   clientY: event.clientY
               });
         }
          longPressTimer = null;
     } else if (!isPanning) {
         // Handle click for non-touch devices if not panning
         handleCanvasClick(event);
     }
      isPanning = false; // Reset panning state
}


function getPoint(event) {
     // Helper to get consistent coordinates from mouse/touch events
     if (event.touches && event.touches.length > 0) {
          return { x: event.touches[0].pageX, y: event.touches[0].pageY, clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
     } else {
          return { x: event.pageX, y: event.pageY, clientX: event.clientX, clientY: event.clientY };
     }
}


// --- Initialization ---
function init() {
    // Basic logger setup
    window.logger = {
        info: (...args) => console.log('[INFO]', ...args),
        warn: (...args) => console.warn('[WARN]', ...args),
        error: (...args) => console.error('[ERROR]', ...args),
        debug: (...args) => console.log('[DEBUG]', ...args), // Simple console.log for debug
    };

    // Setup canvas dimensions
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Attach input listeners using Pointer Events API for unified mouse/touch
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp); // Treat cancel like up
    canvas.addEventListener('contextmenu', handleContextMenu); // For right-click flagging

    // Start WebSocket connection
    connectWebSocket();

    // Start rendering loop
    requestAnimationFrame(drawGame);

    logger.info('Client application initialized.');
}

init(); // Start the application