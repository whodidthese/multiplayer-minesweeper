// minesweeper-server/src/db/repository.js
const db = require('./connection'); // The initialized db connection
const { MAP_WIDTH, MAP_HEIGHT } = require('../config/mapConstants');
const logger = require('../utils/logger');

// --- Promise Wrappers for sqlite3 methods ---

function dbGet(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) {
                logger.error(`DB Error (get): ${query}`, params, err.message);
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                logger.error(`DB Error (all): ${query}`, params, err.message);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        // Using function() syntax to access 'this' which contains lastID, changes
        db.run(query, params, function(err) {
            if (err) {
                logger.error(`DB Error (run): ${query}`, params, err.message);
                reject(err);
            } else {
                // Resolve with the result object containing lastID and changes
                resolve({ lastID: this.lastID, changes: this.changes });
            }
        });
    });
}

// --- Repository Functions ---

/**
 * Retrieves the state of a single cell from the database.
 * Returns undefined if the cell is in its default hidden state.
 */
async function getCellState(x, y) {
    const query = `SELECT * FROM map_state WHERE x = ? AND y = ?`;
    return await dbGet(query, [x, y]);
}

/**
 * Retrieves the state of all non-default cells within a given rectangular region.
 * Handles coordinate wrapping across map boundaries.
 */
async function getCellStatesInRegion(xMin, yMin, xMax, yMax) {
    let conditions = [];
    let params = [];

    // --- X-coordinate handling with wrapping ---
    if (xMin <= xMax) {
        // No X wrapping
        conditions.push(`x BETWEEN ? AND ?`);
        params.push(xMin, xMax);
    } else {
        // X wraps around (e.g., xMin=630, xMax=10)
        conditions.push(`(x >= ? OR x <= ?)`); // Note: OR condition
        params.push(xMin, xMax);
    }

    // --- Y-coordinate handling with wrapping ---
     if (yMin <= yMax) {
        // No Y wrapping
        conditions.push(`y BETWEEN ? AND ?`);
        params.push(yMin, yMax);
    } else {
        // Y wraps around (e.g., yMin=630, yMax=10)
        conditions.push(`(y >= ? OR y <= ?)`); // Note: OR condition
        params.push(yMin, yMax);
    }

    const query = `SELECT * FROM map_state WHERE ${conditions.join(' AND ')}`;
    // logger.debug(`getCellStatesInRegion Query: ${query} Params: ${params}`);
    return await dbAll(query, params);
}

/**
 * Inserts or replaces the state of a revealed cell.
 * Use this when a cell is definitively revealed (safe or mine).
 */
async function upsertRevealedCellState(cellData) {
    const { x, y, is_mine, adjacent_mines } = cellData;
    // Ensures revealed=1 and flag_state=0 when revealing
    const query = `
        INSERT OR REPLACE INTO map_state
        (x, y, revealed, is_mine, adjacent_mines, flag_state)
        VALUES (?, ?, 1, ?, ?, 0)
    `;
    await dbRun(query, [x, y, is_mine, adjacent_mines]);
}

/**
 * Sets the flag state for a cell. Assumes cell is currently hidden.
 * If setting flag_state = 1, inserts a record.
 * If setting flag_state = 0, removes the record (if it only existed for the flag).
 */
async function setFlagState(x, y, flagValue) {
     if (flagValue === 1) {
        // Add flag: Insert a record marking it as flagged and not revealed
        const query = `
            INSERT OR IGNORE INTO map_state
            (x, y, revealed, flag_state)
            VALUES (?, ?, 0, 1)
        `;
        await dbRun(query, [x, y]);
    } else {
        // Remove flag: Delete the record ONLY if it was not revealed
        const query = `DELETE FROM map_state WHERE x = ? AND y = ? AND revealed = 0`;
        await dbRun(query, [x, y]);
    }
}


/**
 * Finds a player by ID, creating a new record if they don't exist.
 * Also updates last_seen timestamp.
 */
async function findOrCreatePlayer(playerId) {
    const now = new Date().toISOString();
    // Try to update last_seen first (common case)
    const updateQuery = `UPDATE players SET last_seen = ? WHERE player_id = ?`;
    const updateResult = await dbRun(updateQuery, [now, playerId]);

    let player;
    if (updateResult.changes === 0) {
        // Player didn't exist, insert them with score 0
        const insertQuery = `INSERT OR IGNORE INTO players (player_id, score, last_seen) VALUES (?, 0, ?)`;
        await dbRun(insertQuery, [playerId, now]);
        // Retrieve the newly created player (or existing if race condition)
         player = await dbGet(`SELECT * FROM players WHERE player_id = ?`, [playerId]);
         logger.info(`Created new player: ${playerId}`);
    } else {
         // Player existed, retrieve their data
         player = await dbGet(`SELECT * FROM players WHERE player_id = ?`, [playerId]);
    }
     // Ensure last_seen is updated even if retrieved after potential insert race condition
     if (player && player.last_seen !== now) {
        await dbRun(updateQuery, [now, playerId]); // Ensure last_seen is current
        player.last_seen = now; // Update local object too
     }
     return player;
}

/**
 * Retrieves the current score for a player.
 */
async function getPlayerScore(playerId) {
    const query = `SELECT score FROM players WHERE player_id = ?`;
    const result = await dbGet(query, [playerId]);
    return result ? result.score : 0; // Return 0 if player not found for some reason
}

/**
 * Updates a player's score by a given delta (can be positive or negative).
 */
async function updatePlayerScore(playerId, scoreDelta) {
    const query = `UPDATE players SET score = score + ? WHERE player_id = ?`;
    await dbRun(query, [scoreDelta, playerId]);
    // Optionally return the new score, but requires another query
}

/**
 * Updates the last_seen timestamp for a player.
 */
async function updatePlayerLastSeen(playerId) {
     const now = new Date().toISOString();
     const query = `UPDATE players SET last_seen = ? WHERE player_id = ?`;
     await dbRun(query, [now, playerId]);
}


module.exports = {
    getCellState,
    getCellStatesInRegion,
    upsertRevealedCellState,
    setFlagState,
    findOrCreatePlayer,
    getPlayerScore,
    updatePlayerScore,
    updatePlayerLastSeen,
    // Expose raw methods if needed elsewhere, but generally use the repo functions
    // dbGet, dbAll, dbRun
};