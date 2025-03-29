// minesweeper-server/src/network/webSocketServer.js
const WebSocket = require('ws');
const logger = require('../utils/logger');
// Placeholder for message handling logic (will import gameController later)
// const gameController = require('../controllers/gameController');

// #MODIFIED
const gameController = require('../controllers/gameController');

function initializeWebSocketServer(httpServer) {
	const wss = new WebSocket.Server({ server: httpServer }); // Attach WebSocket server to HTTP server

	logger.info('WebSocket server initialized.');

	wss.on('connection', (ws, req) => {
		// 'ws' is the WebSocket object for this specific client connection
		// 'req' is the initial HTTP upgrade request (can be used for IP, headers, etc.)
		const clientIp = req.socket.remoteAddress;
		logger.info(`Client connected: ${clientIp}`);

		gameController.handleConnect(ws).catch(err => {
			logger.error("Error during player connection handling:", err);
			ws.close(); // Close connection if setup fails
		});

		// TODO: Implement player session creation via playerManager
		// Assign a unique ID to this connection/player session

		ws.on('message', (message) => {
			try {
				// Assuming messages are JSON strings
				const parsedMessage = JSON.parse(message);
				logger.debug(`Received message: ${JSON.stringify(parsedMessage)} from ${clientIp}`);

				// TODO: Route message to gameController based on parsedMessage.type
				// Example placeholder:
				// gameController.handleMessage(ws, parsedMessage);

				// #MODIFIED
				gameController.handleMessage(ws, parsedMessage).catch(err => {
					logger.error("Error handling client message:", err);
					// Optionally send error back to client ws
				});

			} catch (error) {
				logger.error(`Failed to parse message or invalid message format: ${message}`, error);
				// Optionally send an error message back to the client
				// ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
			}
		});

		ws.on('close', (code, reason) => {
			logger.info(`Client disconnected: ${clientIp}. Code: ${code}, Reason: ${reason}`);

			gameController.handleDisconnect(ws);

			// TODO: Implement player session cleanup via playerManager
		});

		ws.on('error', (error) => {
			logger.error(`WebSocket error for client ${clientIp}:`, error);
			// Connection might close automatically after an error
		});

		// Send a welcome message (optional)
		// ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to Minesweeper!' }));
	});

	wss.on('error', (error) => {
		// Handle errors on the WebSocket server itself (e.g., address in use)
		logger.error('WebSocket Server error:', error);
	});

	return wss; // Return the server instance if needed elsewhere
}

module.exports = initializeWebSocketServer;