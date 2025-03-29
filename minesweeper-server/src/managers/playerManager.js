// minesweeper-server/src/managers/playerManager.js
const crypto = require('crypto'); // For generating unique IDs
const dbRepository = require('../db/repository');
const { MAP_WIDTH, MAP_HEIGHT } = require('../config/mapConstants');
const logger = require('../utils/logger');

// In-memory storage for active players
// map: playerId -> { ws, id, x, y, score }
const activePlayers = new Map();
// map: ws -> playerId (for quick lookup on disconnect)
const wsToPlayerId = new Map();

/**
 * Adds a new player session when a client connects via WebSocket.
 * Generates a unique ID, retrieves/creates player data from DB.
 * @param {WebSocket} ws - The WebSocket connection object for the player.
 * @returns {Promise<object | null>} - The player object { id, x, y, score } or null on error.
 */
async function addPlayer(ws) {
    const playerId = crypto.randomUUID();
    logger.info(`Attempting to add player with generated ID: ${playerId}`);

    try {
        // Get existing player data or create a new entry in the DB
        const dbPlayer = await dbRepository.findOrCreatePlayer(playerId);
        if (!dbPlayer) {
             throw new Error('Failed to find or create player in database.');
        }

        const player = {
            ws: ws,
            id: playerId,
            x: Math.floor(MAP_WIDTH / 2), // Default starting position (center)
            y: Math.floor(MAP_HEIGHT / 2),
            score: dbPlayer.score // Initialize score from DB
        };

        activePlayers.set(playerId, player);
        wsToPlayerId.set(ws, playerId);

        logger.info(`Player ${playerId} added. Active players: ${activePlayers.size}`);
        return { id: player.id, x: player.x, y: player.y, score: player.score };

    } catch (error) {
        logger.error(`Error adding player ${playerId}:`, error);
        return null;
    }
}

/**
 * Removes a player session when their WebSocket connection closes.
 * @param {WebSocket} ws - The WebSocket connection object that closed.
 * @returns {string | null} - The ID of the player who was removed, or null if not found.
 */
function removePlayer(ws) {
    const playerId = wsToPlayerId.get(ws);
    if (playerId && activePlayers.has(playerId)) {
        activePlayers.delete(playerId);
        wsToPlayerId.delete(ws);
        logger.info(`Player ${playerId} removed. Active players: ${activePlayers.size}`);

        // Optionally update last_seen in DB here or rely on periodic checks
        dbRepository.updatePlayerLastSeen(playerId).catch(err => {
            logger.error(`Failed to update last_seen for disconnected player ${playerId}:`, err);
        });

        return playerId;
    } else {
        logger.warn(`Attempted to remove player but ID not found for WebSocket.`);
        return null;
    }
}

/**
 * Updates the position of an active player.
 * @param {string} playerId - The ID of the player.
 * @param {number} x - The new x-coordinate.
 * @param {number} y - The new y-coordinate.
 */
function updatePlayerPosition(playerId, x, y) {
    const player = activePlayers.get(playerId);
    if (player) {
        // Basic validation/clamping (optional, depends if client sends invalid coords)
        player.x = Math.max(0, Math.min(MAP_WIDTH - 1, x));
        player.y = Math.max(0, Math.min(MAP_HEIGHT - 1, y));
        // logger.debug(`Player ${playerId} position updated to (${player.x}, ${player.y})`);
    } else {
         logger.warn(`Attempted to update position for unknown player ID: ${playerId}`);
    }
}

/**
 * Updates the score for an active player in memory.
 * Assumes the score is already updated in the DB elsewhere.
 * @param {string} playerId - The ID of the player.
 * @param {number} newScore - The player's new score.
 */
function updatePlayerScore(playerId, newScore) {
     const player = activePlayers.get(playerId);
    if (player) {
        player.score = newScore;
         logger.debug(`Player ${playerId} score updated in memory to ${newScore}`);
    }
}


/**
 * Retrieves the data object for a single active player by ID.
 * @param {string} playerId - The ID of the player.
 * @returns {object | undefined} - The player data object or undefined if not found/active.
 */
function getPlayerById(playerId) {
    return activePlayers.get(playerId);
}

/**
 * Retrieves the ID associated with a WebSocket connection.
 * @param {WebSocket} ws - The WebSocket connection.
 * @returns {string | undefined} - The player ID or undefined.
 */
function getPlayerIdByWs(ws) {
    return wsToPlayerId.get(ws);
}


/**
 * Finds all active players within a given rectangular region.
 * Handles coordinate wrapping.
 * @param {number} xMin - Minimum x-coordinate of the region.
 * @param {number} yMin - Minimum y-coordinate of the region.
 * @param {number} xMax - Maximum x-coordinate of the region.
 * @param {number} yMax - Maximum y-coordinate of the region.
 * @param {string} [excludePlayerId] - Optional ID of a player to exclude from the results.
 * @returns {Array<object>} - An array of player objects { id, x, y } within the region.
 */
function getPlayersInRegion(xMin, yMin, xMax, yMax, excludePlayerId = null) {
    const nearbyPlayers = [];
    const checkXWrap = xMin > xMax;
    const checkYWrap = yMin > yMax;

    for (const [id, player] of activePlayers.entries()) {
        if (id === excludePlayerId) {
            continue;
        }

        const { x, y } = player;

        // Check X coordinate
        let x_in_region = false;
        if (checkXWrap) {
            x_in_region = (x >= xMin || x <= xMax);
        } else {
            x_in_region = (x >= xMin && x <= xMax);
        }

        if (!x_in_region) continue; // Skip if X is not in region

        // Check Y coordinate
        let y_in_region = false;
         if (checkYWrap) {
            y_in_region = (y >= yMin || y <= yMax);
        } else {
            y_in_region = (y >= yMin && y <= yMax);
        }

        if (y_in_region) {
             // Return only necessary info for broadcasting
            nearbyPlayers.push({ id: player.id, x: player.x, y: player.y });
        }
    }
    return nearbyPlayers;
}

/**
 * Retrieves all currently active players.
 * @returns {Array<object>} - An array of player objects { id, x, y, score }.
 */
function getAllActivePlayers() {
    // Return data safe for broader use (don't expose ws object)
    return Array.from(activePlayers.values()).map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        score: p.score
    }));
}


module.exports = {
    addPlayer,
    removePlayer,
    updatePlayerPosition,
    updatePlayerScore,
    getPlayerById,
    getPlayerIdByWs,
    getPlayersInRegion,
    getAllActivePlayers,
    // Expose map directly ONLY if absolutely necessary and with caution
    // _activePlayers: activePlayers
};