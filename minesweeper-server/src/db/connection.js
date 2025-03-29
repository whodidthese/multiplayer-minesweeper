// minesweeper-server/src/db/connection.js
const sqlite3 = require('sqlite3').verbose(); // Use verbose for more detailed errors
const config = require('../config');
const logger = require('../utils/logger');

const dbFile = config.databasePath;
logger.info(`Connecting to database: ${dbFile}`);

// Create or open the database
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        logger.error('Error opening database:', err.message);
        process.exit(1); // Exit if DB connection fails
    } else {
        logger.info('Successfully connected to the SQLite database.');
        setupDatabaseSchema(); // Ensure tables are created
    }
});

function setupDatabaseSchema() {
    db.serialize(() => {
        // Enable Write-Ahead Logging for better concurrency
        db.run("PRAGMA journal_mode=WAL;", (err) => {
            if (err) {
                logger.error("Failed to enable WAL mode:", err.message);
            } else {
                logger.info("WAL mode enabled.");
            }
        });

        // Create map_state table if it doesn't exist
        // Stores revealed cells and flags
        db.run(`
            CREATE TABLE IF NOT EXISTS map_state (
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                revealed INTEGER NOT NULL DEFAULT 0,
                is_mine INTEGER,           -- NULL if not revealed or not a mine
                adjacent_mines INTEGER, -- NULL if not revealed or is a mine
                flag_state INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (x, y)
            ) WITHOUT ROWID; -- Optimization for tables with integer primary key covering all columns needed for lookup
        `, (err) => {
            if (err) {
                logger.error("Error creating map_state table:", err.message);
            } else {
                // logger.debug("map_state table checked/created."); // Less noisy
            }
        });

        // Create players table if it doesn't exist
        db.run(`
            CREATE TABLE IF NOT EXISTS players (
                player_id TEXT PRIMARY KEY,
                score INTEGER NOT NULL DEFAULT 0,
                last_seen TIMESTAMP NOT NULL
            )
        `, (err) => {
            if (err) {
                logger.error("Error creating players table:", err.message);
            } else {
                // logger.debug("players table checked/created."); // Less noisy
                 logger.info("Database schema checked/created successfully.");
            }
        });

        // Optional: Create indexes if needed (Primary keys already create indexes)
        // db.run("CREATE INDEX IF NOT EXISTS idx_map_state_coords ON map_state(x, y);"); // Already covered by PK
    });
}

// Export the database connection instance
module.exports = db;