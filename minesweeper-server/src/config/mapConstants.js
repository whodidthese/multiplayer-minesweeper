// minesweeper-server/src/config/mapConstants.js
const config = require('./index'); // Ensure mapSeed is loaded

const mapConstants = {
    MAP_WIDTH: 640,
    MAP_HEIGHT: 640,
    MINE_DENSITY: 0.15, // 15% density
    MAP_SEED: config.mapSeed // Get seed from main config
};

// Simple validation
if (typeof mapConstants.MAP_SEED !== 'string' || mapConstants.MAP_SEED.length < 10) {
     console.error("ERROR: MAP_SEED is missing or too short in config. Exiting.");
     process.exit(1); // Exit if seed is problematic
}


module.exports = mapConstants;