// minesweeper-server/src/core/gameStateManager.js
const dbRepository = require('../db/repository');
const gameUtils = require('./gameUtils');
const logger = require('../utils/logger');
const { MAP_WIDTH, MAP_HEIGHT } = require('../config/mapConstants');

const SCORE_REVEAL_SAFE = 1;
const SCORE_HIT_MINE_PENALTY = -50; // Example penalty
const STUN_DURATION_MS = 3000; // 3 seconds stun on mine hit

/**
 * Handles the logic for revealing a cell.
 * Checks if the cell is a mine or safe, performs flood fill if necessary,
 * updates database state and player score.
 *
 * @param {string} playerId - The ID of the player performing the action.
 * @param {number} x - The x-coordinate of the cell.
 * @param {number} y - The y-coordinate of the cell.
 * @returns {Promise<object>} - An object describing the result:
 * { status: 'ignored' | 'mine_hit' | 'revealed',
 * scoreDelta?: number, // Change in score for this action
 * stunDurationMs?: number, // If mine hit
 * revealedCells?: Array<object> // List of cells revealed {x, y, state, value}
 * }
 */
async function revealCell(playerId, x, y) {
    // 1. Check current state in DB
    const existingState = await dbRepository.getCellState(x, y);

    // Ignore if already revealed or flagged
    if (existingState?.revealed === 1 || existingState?.flag_state === 1) {
        logger.debug(`Ignoring reveal at (${x}, ${y}): Already revealed or flagged.`);
        return { status: 'ignored' };
    }

    // 2. Check if it's a mine
    const isMine = gameUtils.isMine(x, y);

    if (isMine) {
        logger.info(`Player ${playerId} hit a mine at (${x}, ${y})`);
        const cellData = { x, y, is_mine: 1, adjacent_mines: null };
        await dbRepository.upsertRevealedCellState(cellData); // Mark mine as revealed
        await dbRepository.updatePlayerScore(playerId, SCORE_HIT_MINE_PENALTY);

        return {
            status: 'mine_hit',
            scoreDelta: SCORE_HIT_MINE_PENALTY,
            stunDurationMs: STUN_DURATION_MS,
            revealedCells: [{ x, y, state: 'mine', value: -1 }] // Single revealed cell (the mine)
        };
    } else {
        // 3. Safe cell - Perform flood fill starting from this cell
        const { revealedCells, scoreDelta } = await performSafeReveal(x, y, playerId);

         if (revealedCells.length === 0) {
             // This might happen if the initial cell was somehow already processed
             // in a concurrent request, though less likely with async/await handling.
             logger.warn(`Safe reveal at (${x}, ${y}) resulted in 0 revealed cells.`);
             return { status: 'ignored' };
         }

        logger.info(`Player ${playerId} revealed ${revealedCells.length} safe cells starting at (${x}, ${y}). Score delta: ${scoreDelta}`);
        return {
            status: 'revealed',
            scoreDelta: scoreDelta,
            revealedCells: revealedCells.map(cell => ({
                x: cell.x,
                y: cell.y,
                state: 'revealed',
                value: cell.adjacent_mines // Value is the adjacent mine count
            }))
        };
    }
}


/**
 * Internal function to handle revealing safe cells and flood fill.
 * Uses an iterative approach with a queue.
 * @param {number} startX - Initial safe cell X to reveal.
 * @param {number} startY - Initial safe cell Y to reveal.
 * @param {string} playerId - The player performing the reveal.
 * @returns {Promise<{revealedCells: Array<object>, scoreDelta: number}>} - List of cells newly revealed by this operation and total score change.
 */
async function performSafeReveal(startX, startY, playerId) {
    const cellsToReveal = []; // Cells confirmed safe in this operation
    const queue = [{ x: startX, y: startY }]; // Queue for flood fill
    const visited = new Set(); // Track cells processed in *this* flood fill operation (key: "x,y")
    visited.add(`${startX},${startY}`);

    let scoreChange = 0;

    // Use transaction for batch DB updates
    // Note: sqlite3 library doesn't directly support nested transactions easily.
    // We'll batch the DB writes after the logic. Using BEGIN/COMMIT manually is possible too.
    // For simplicity here, we await individual upserts, relying on WAL for concurrency.
    // A true batch update would be more performant.

    while (queue.length > 0) {
        const { x, y } = queue.shift();

        // Double-check DB state in case of concurrency, although less likely needed now
        const currentState = await dbRepository.getCellState(x, y);
        if (currentState?.revealed === 1 || currentState?.flag_state === 1) {
            continue; // Already revealed or flagged (maybe by another player concurrently)
        }

        // Calculate adjacent mines
        const adjacentMines = gameUtils.calculateAdjacentMines(x, y);
        const cellData = { x, y, is_mine: 0, adjacent_mines: adjacentMines };

        // Add to list of cells revealed in this operation
        cellsToReveal.push(cellData);
        scoreChange += SCORE_REVEAL_SAFE;

        // If the cell has 0 adjacent mines, add its neighbors to the queue for flood fill
        if (adjacentMines === 0) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;

                    const nx = x + dx;
                    const ny = y + dy;
                    const eff_nx = (nx + MAP_WIDTH) % MAP_WIDTH;
                    const eff_ny = (ny + MAP_HEIGHT) % MAP_HEIGHT;
                    const neighborKey = `${eff_nx},${eff_ny}`;

                    // Add to queue only if within bounds and not already visited *in this operation*
                     if (eff_nx >= 0 && eff_nx < MAP_WIDTH && eff_ny >= 0 && eff_ny < MAP_HEIGHT && !visited.has(neighborKey)) {
                        // Check DB state before adding to queue is crucial to avoid processing already revealed/flagged
                        const neighborState = await dbRepository.getCellState(eff_nx, eff_ny);
                        if (!neighborState || (neighborState.revealed !== 1 && neighborState.flag_state !== 1)) {
                             queue.push({ x: eff_nx, y: eff_ny });
                             visited.add(neighborKey);
                        }
                    }
                }
            }
        }
    }

    // Batch update database (or update sequentially)
    if (cellsToReveal.length > 0) {
        // Update DB for all revealed cells
        // Using Promise.all for concurrent DB updates (can stress DB, adjust if needed)
        const dbPromises = cellsToReveal.map(cell =>
            dbRepository.upsertRevealedCellState(cell)
        );
        await Promise.all(dbPromises);

        // Update player score once for the total change
        await dbRepository.updatePlayerScore(playerId, scoreChange);
    }

    return { revealedCells: cellsToReveal, scoreDelta: scoreChange };
}


/**
 * Handles the logic for toggling a flag on a cell.
 *
 * @param {string} playerId - The ID of the player performing the action (unused currently, but good practice).
 * @param {number} x - The x-coordinate of the cell.
 * @param {number} y - The y-coordinate of the cell.
 * @returns {Promise<object>} - An object describing the result:
 * { status: 'ignored' | 'flagged' | 'unflagged',
 * cellState?: { x, y, state } // The new state to broadcast
 * }
 */
async function toggleFlag(playerId, x, y) {
    // 1. Check current state in DB
    const existingState = await dbRepository.getCellState(x, y);

    // Cannot flag/unflag an already revealed cell
    if (existingState?.revealed === 1) {
        logger.debug(`Ignoring flag toggle at (${x}, ${y}): Cell already revealed.`);
        return { status: 'ignored' };
    }

    let newState;
    if (existingState?.flag_state === 1) {
        // Currently flagged -> Unflag
        await dbRepository.setFlagState(x, y, 0); // Removes the flag record
        logger.debug(`Player ${playerId} unflagged cell (${x}, ${y})`);
        newState = 'hidden'; // Cell returns to default hidden state
        return { status: 'unflagged', cellState: { x, y, state: newState } };
    } else {
        // Currently not flagged (or no record exists) -> Flag
        await dbRepository.setFlagState(x, y, 1); // Adds a flag record
        logger.debug(`Player ${playerId} flagged cell (${x}, ${y})`);
        newState = 'flagged';
        return { status: 'flagged', cellState: { x, y, state: newState } };
    }
}

module.exports = {
    revealCell,
    toggleFlag,
};