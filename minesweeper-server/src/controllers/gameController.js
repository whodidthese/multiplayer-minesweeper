// minesweeper-server/src/controllers/gameController.js
const playerManager = require('../managers/playerManager');
const gameStateManager = require('../core/gameStateManager');
const dbRepository = require('../db/repository'); // Might need for fetching region state
const { MAP_WIDTH, MAP_HEIGHT } = require('../config/mapConstants');
const logger = require('../utils/logger');

// --- Broadcasting Helper ---

/**
 * Sends a message to all players within a specified region, excluding one optional player.
 * @param {number} centerX - Center X of the region (for finding players).
 * @param {number} centerY - Center Y of the region.
 * @param {number} radiusX - Half-width of the region to broadcast to.
 * @param {number} radiusY - Half-height of the region to broadcast to.
 * @param {object} message - The message object to send (will be stringified).
 * @param {string|null} excludePlayerId - Player ID to not send the message to.
 */
function broadcastToRegion(centerX, centerY, radiusX, radiusY, message, excludePlayerId = null) {
    // Define the bounding box for the query, handling wrapping
    let xMin = (centerX - radiusX + MAP_WIDTH) % MAP_WIDTH;
    let xMax = (centerX + radiusX) % MAP_WIDTH;
    let yMin = (centerY - radiusY + MAP_HEIGHT) % MAP_HEIGHT;
    let yMax = (centerY + radiusY) % MAP_HEIGHT;

    // Adjust bounds if they don't wrap correctly for the playerManager function
    // (playerManager handles wrap, but let's ensure consistent input if needed)
    // This calculation might need refinement based on exact viewport definition

    const playersInRegion = playerManager.getPlayersInRegion(xMin, yMin, xMax, yMax, excludePlayerId);
    const messageString = JSON.stringify(message);

    // logger.debug(`Broadcasting type ${message.type} to ${playersInRegion.length} players near (${centerX},${centerY})`);

    playersInRegion.forEach(p => {
        const playerSession = playerManager.getPlayerById(p.id); // Get full session data
        if (playerSession && playerSession.ws && playerSession.ws.readyState === WebSocket.OPEN) { // Check if WebSocket is defined and open
            playerSession.ws.send(messageString);
        }
    });
}

// Define viewport dimensions (adjust as needed)
// This determines the initial load area and broadcast range
const VIEWPORT_RADIUS_X = 30;
const VIEWPORT_RADIUS_Y = 20;

// --- Connection Handling ---

/**
 * Handles a new WebSocket connection.
 * Adds the player, sends initial state, and notifies others.
 * @param {WebSocket} ws - The WebSocket connection object.
 */
async function handleConnect(ws) {
    const newPlayerData = await playerManager.addPlayer(ws);

    if (newPlayerData) {
        const { id: playerId, x, y, score } = newPlayerData;

        // Define initial viewport region
        let xMin = (x - VIEWPORT_RADIUS_X + MAP_WIDTH) % MAP_WIDTH;
        let xMax = (x + VIEWPORT_RADIUS_X) % MAP_WIDTH;
        let yMin = (y - VIEWPORT_RADIUS_Y + MAP_HEIGHT) % MAP_HEIGHT;
        let yMax = (y + VIEWPORT_RADIUS_Y) % MAP_HEIGHT;

        // Fetch initial map state for the region
        const cellsData = await dbRepository.getCellStatesInRegion(xMin, yMin, xMax, yMax);
        const mapChunk = cellsData.map(cell => ({
            x: cell.x,
            y: cell.y,
            // Determine state based on DB values
            state: cell.revealed ? (cell.is_mine ? 'mine' : 'revealed') : (cell.flag_state ? 'flagged' : 'hidden'),
            value: cell.revealed && !cell.is_mine ? cell.adjacent_mines : (cell.revealed && cell.is_mine ? -1 : null)
        }));

        // Fetch nearby players (excluding self)
        const nearbyPlayers = playerManager.getPlayersInRegion(xMin, yMin, xMax, yMax, playerId);

        // Send initial state to the new player
        const initialStateMessage = {
            type: 'initialState',
            data: {
                playerId: playerId,
                score: score,
                mapChunk: { // Sending absolute coordinates, client maps to viewport
                    cells: mapChunk
                },
                players: nearbyPlayers, // Players already nearby
                // Include player's own initial position
                self: { x, y }
            }
        };
        ws.send(JSON.stringify(initialStateMessage));

        // Notify nearby players that someone new joined
        const playerJoinedMessage = {
            type: 'playerJoined',
            data: { id: playerId, x: x, y: y }
        };
        broadcastToRegion(x, y, VIEWPORT_RADIUS_X, VIEWPORT_RADIUS_Y, playerJoinedMessage, playerId); // Exclude self

    } else {
        logger.error("Failed to add player on connect, closing WebSocket.");
        ws.close();
    }
}

/**
 * Handles a WebSocket disconnection.
 * Removes the player and notifies others.
 * @param {WebSocket} ws - The WebSocket connection object that closed.
 */
function handleDisconnect(ws) {
    const playerId = playerManager.getPlayerIdByWs(ws);
    if (playerId) {
        const player = playerManager.getPlayerById(playerId); // Get data before removing
        const lastX = player ? player.x : Math.floor(MAP_WIDTH / 2); // Use last known position
        const lastY = player ? player.y : Math.floor(MAP_HEIGHT / 2);

        playerManager.removePlayer(ws); // Remove from active list

        // Notify nearby players
        const playerLeftMessage = {
            type: 'playerLeft',
            data: { id: playerId }
        };
        // Broadcast around the player's *last known* position
        broadcastToRegion(lastX, lastY, VIEWPORT_RADIUS_X, VIEWPORT_RADIUS_Y, playerLeftMessage, null); // Don't exclude anyone
    }
}

// --- Message Handling ---

/**
 * Handles incoming messages from a WebSocket client.
 * @param {WebSocket} ws - The client's WebSocket connection.
 * @param {object} message - The parsed message object.
 */
async function handleMessage(ws, message) {
    const playerId = playerManager.getPlayerIdByWs(ws);
    if (!playerId) {
        logger.warn("Received message from WebSocket without associated player ID. Ignoring.");
        return;
    }

    // Update last_seen timestamp on any message activity
    dbRepository.updatePlayerLastSeen(playerId).catch(err => {
         logger.error(`Failed to update last_seen for active player ${playerId}:`, err);
    });

    const player = playerManager.getPlayerById(playerId); // Get current player state
    if (!player) {
         logger.error(`Player ID ${playerId} found for WS, but not in active players map. Inconsistency!`);
         return;
    }


    try {
        switch (message.type) {
            case 'clickCell': {
                const { x, y } = message.data;
                // Basic validation
                if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) {
                    logger.warn(`Invalid coordinates received in clickCell from ${playerId}: (${x}, ${y})`);
                    return;
                }

                const result = await gameStateManager.revealCell(playerId, x, y);

                if (result.status === 'ignored') return;

                if (result.status === 'mine_hit') {
                    // Update score in memory
                    playerManager.updatePlayerScore(playerId, player.score + result.scoreDelta);
                    // Send penalty message to player
                    ws.send(JSON.stringify({
                        type: 'playerPenalty',
                        data: { score: player.score + result.scoreDelta, stunDurationMs: result.stunDurationMs }
                    }));
                    // Broadcast map update for the revealed mine
                    const mapUpdateMessage = { type: 'mapUpdate', data: { cells: result.revealedCells } };
                    broadcastToRegion(x, y, VIEWPORT_RADIUS_X, VIEWPORT_RADIUS_Y, mapUpdateMessage, null);
                } else if (result.status === 'revealed') {
                     // Update score in memory
                    playerManager.updatePlayerScore(playerId, player.score + result.scoreDelta);
                     // Send score update to player
                     ws.send(JSON.stringify({
                        type: 'scoreUpdate',
                        data: { score: player.score + result.scoreDelta }
                    }));
                    // Broadcast map update for all revealed cells
                     const mapUpdateMessage = { type: 'mapUpdate', data: { cells: result.revealedCells } };
                     // Broadcast centered around the initial click
                    broadcastToRegion(x, y, VIEWPORT_RADIUS_X, VIEWPORT_RADIUS_Y, mapUpdateMessage, null);
                }
                break;
            }

            case 'flagCell': {
                const { x, y } = message.data;
                 if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) {
                    logger.warn(`Invalid coordinates received in flagCell from ${playerId}: (${x}, ${y})`);
                    return;
                }

                const result = await gameStateManager.toggleFlag(playerId, x, y);

                if (result.status === 'flagged' || result.status === 'unflagged') {
                    // Broadcast the single cell state change
                    const mapUpdateMessage = { type: 'mapUpdate', data: { cells: [result.cellState] } };
                    broadcastToRegion(x, y, VIEWPORT_RADIUS_X, VIEWPORT_RADIUS_Y, mapUpdateMessage, null);
                }
                break;
            }

            case 'updatePosition': {
                 const { x, y } = message.data;
                 if (typeof x !== 'number' || typeof y !== 'number') { // Allow potentially out-of-bounds coords if client calculates view center
                    logger.warn(`Invalid coordinates received in updatePosition from ${playerId}: (${x}, ${y})`);
                    return;
                }

                // Update position in PlayerManager (clamps/validates internally if needed)
                playerManager.updatePlayerPosition(playerId, x, y);

                // Broadcast new position to nearby players (throttling might be desired here)
                const positionUpdateMessage = {
                    type: 'playerPositionUpdate',
                    data: { players: [{ id: playerId, x: player.x, y: player.y }] } // Send updated pos
                };
                broadcastToRegion(player.x, player.y, VIEWPORT_RADIUS_X, VIEWPORT_RADIUS_Y, positionUpdateMessage, playerId); // Exclude self
                break;
            }

            default:
                logger.warn(`Received unknown message type: ${message.type} from ${playerId}`);
                break;
        }
    } catch (error) {
        logger.error(`Error handling message type ${message.type} for player ${playerId}:`, error);
        // Optionally notify the client of an error
        try {
            ws.send(JSON.stringify({ type: 'error', data: { message: 'Internal server error processing your request.' } }));
        } catch (sendError) {
             logger.error(`Failed to send error message to client ${playerId}:`, sendError);
        }
    }
}


// Need to re-import WebSocket here if using it for type checking
const WebSocket = require('ws');

module.exports = {
    handleConnect,
    handleDisconnect,
    handleMessage,
};