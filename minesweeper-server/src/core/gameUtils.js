// minesweeper-server/src/core/gameUtils.js
const crypto = require('crypto');
const { MAP_WIDTH, MAP_HEIGHT, MAP_SEED, MINE_DENSITY } = require('../config/mapConstants');
const logger = require('../utils/logger');

/**
 * Checks if a given cell contains a mine based on deterministic hashing.
 * @param {number} x - The x-coordinate (0 to MAP_WIDTH - 1).
 * @param {number} y - The y-coordinate (0 to MAP_HEIGHT - 1).
 * @returns {boolean} - True if the cell contains a mine, false otherwise.
 */
function isMine(x, y) {
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) {
        logger.warn(`isMine check out of bounds: (${x}, ${y})`);
        return false; // Treat out-of-bounds as non-mine
    }

    const seedInput = `${MAP_SEED}:${x},${y}`;
    const hash = crypto.createHash('sha256').update(seedInput).digest(); // Get hash Buffer

    // Use the first 8 bytes of the hash for higher precision random value
    // Read as a 64-bit unsigned BigInt (requires Node.js v12+)
    const hashInt = hash.readBigUInt64BE(0);

    // Normalize to a float between 0 (inclusive) and 1 (exclusive)
    // 2n**64n is the maximum value + 1 for a 64-bit unsigned integer
    const normalizedValue = Number(hashInt) / Number(2n**64n);

    return normalizedValue < MINE_DENSITY;
}

/**
 * Calculates the number of mines adjacent to a given cell.
 * Handles coordinate wrapping.
 * @param {number} x - The x-coordinate (0 to MAP_WIDTH - 1).
 * @param {number} y - The y-coordinate (0 to MAP_HEIGHT - 1).
 * @returns {number} - The count of adjacent mines (0-8).
 */
function calculateAdjacentMines(x, y) {
     if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) {
        logger.warn(`calculateAdjacentMines check out of bounds: (${x}, ${y})`);
        return 0;
    }

    let mineCount = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) {
                continue; // Skip the cell itself
            }

            const nx = x + dx;
            const ny = y + dy;

            // Handle coordinate wrapping using modulo arithmetic
            // Ensures positive results for negative inputs before modulo
            const eff_nx = (nx + MAP_WIDTH) % MAP_WIDTH;
            const eff_ny = (ny + MAP_HEIGHT) % MAP_HEIGHT;

            if (isMine(eff_nx, eff_ny)) {
                mineCount++;
            }
        }
    }
    return mineCount;
}

module.exports = {
    isMine,
    calculateAdjacentMines,
};