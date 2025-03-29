// minesweeper-server/server.js
const http = require('http');
const config = require('./src/config');
const mapConstants = require('./src/config/mapConstants'); // Load map constants (for logging/info)
const initializeHttpServer = require('./src/network/httpServer');
const initializeWebSocketServer = require('./src/network/webSocketServer');
const db = require('./src/db/connection'); // Initialize DB connection
const logger = require('./src/utils/logger'); // Basic logger

logger.info('Starting Minesweeper Server...');
logger.info(`Using Map Seed: ${mapConstants.MAP_SEED.substring(0, 10)}...`); // Don't log full seed
logger.info(`Map Dimensions: ${mapConstants.MAP_WIDTH}x${mapConstants.MAP_HEIGHT}`);
logger.info(`Database Path: ${config.databasePath}`);

// 1. Create HTTP Server
// We pass the db connection or other dependencies if httpServer needs them later
const httpServer = initializeHttpServer();

// 2. Initialize WebSocket Server and attach it to the HTTP server
// Pass the httpServer instance to the WebSocket initializer
initializeWebSocketServer(httpServer);

// 3. Start the HTTP server
httpServer.listen(config.port, () => {
    logger.info(`Server listening on http://localhost:${config.port}`);
});

// Graceful Shutdown Handling (Optional but Recommended)
process.on('SIGINT', () => {
    logger.info('SIGINT signal received: closing HTTP server');
    httpServer.close(() => {
        logger.info('HTTP server closed');
        db.close((err) => { // Close DB connection
            if (err) {
                logger.error('Error closing database:', err.message);
            } else {
                logger.info('Database connection closed');
            }
            process.exit(0);
        });
    });
});

process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
     httpServer.close(() => {
        logger.info('HTTP server closed');
         db.close((err) => { // Close DB connection
            if (err) {
                logger.error('Error closing database:', err.message);
            } else {
                logger.info('Database connection closed');
            }
            process.exit(0);
        });
    });
});