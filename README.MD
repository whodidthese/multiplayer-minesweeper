# Google Gemini 2.5 Pro Multiplayer Minesweeper #

A real-time, multiplayer version of the classic Minesweeper game featuring a shared, wrapping map. Built with Node.js, WebSockets, SQLite, and an HTML5 Canvas frontend.

## Overview

This project implements a persistent, shared Minesweeper world where multiple players can connect simultaneously via WebSockets. Players can see each other's cursors, reveal parts of the map, flag potential mines, and compete (or collaborate) on a 640x640 map that wraps around in all directions (toroidal). The game state (revealed cells, flags, player scores) is persisted using SQLite.

## Features (MVP)

* **Real-time Multiplayer:** Multiple players interact on the same map simultaneously via WebSockets.
* **Shared Map State:** Reveals and flags by one player are visible to others in real-time.
* **Wrapping Map:** The 640x640 grid wraps horizontally and vertically.
* **Player Visibility:** See the cursors of other nearby players.
* **Standard Minesweeper Rules:** Left-click/Tap to reveal, Right-click/Long-press to flag.
* **Procedural Mines:** Mine locations are determined deterministically based on coordinates and a map seed.
* **Scoring & Penalties:** Basic score for reveals, penalty and temporary stun for hitting mines.
* **Persistence:** Map state (revealed/flagged cells) and player scores are saved in an SQLite database.
* **Canvas Rendering:** Frontend rendered using HTML5 Canvas.
* **Basic Mobile Support:** Touch controls for reveal, flag, and panning.

## Technology Stack

* **Backend:** Node.js, `ws` (WebSockets), `sqlite3`, `dotenv`
* **Frontend:** Vanilla JavaScript, HTML5 Canvas, CSS3
* **Database:** SQLite

## Getting Started

Follow these instructions to get the server running locally for development or testing.

**Prerequisites:**

* Node.js (Version 18.x or higher recommended)
* npm (usually included with Node.js)

**Installation & Setup:**

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/whodidthese/multiplayer-minesweeper
    cd multiplayer-minesweeper
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create configuration file:**
    * Copy the example environment file: `cp .env.example .env`
    * **Edit the `.env` file:**
        * **CRITICAL:** Change `MAP_SEED` to a unique, secret string. This determines the mine layout. Changing it will reset the map state effectively.
        * Adjust `PORT` or `DATABASE_PATH` if needed.

4.  **Run the server:**
    * For production-like start: `npm start`
    * For development with automatic restart on file changes (Node >= 18): `npm run dev`

5.  **Access the application:**
    * Open your web browser and navigate to `http://localhost:PORT` (e.g., `http://localhost:8080` if using the default port).

## How to Play

* **Reveal:** Left-click or Tap on a hidden cell.
* **Flag:** Right-click or Long-press (hold for ~0.5 seconds) on a hidden cell to place/remove a flag (🚩).
* **Pan:** Click and drag (or touch and drag) the map to move your view.
* **Objective:** Reveal safe cells, avoid mines (💣), and achieve a high score! Your actions update the map for everyone nearby.

## Project Structure

```text
minesweeper-server/
├── public/                 # Static frontend files served by HTTP server
│   ├── index.html          # Main HTML page
│   ├── css/
│   │   └── style.css       # Stylesheet
│   └── js/
│       └── app.js          # Client-side JavaScript bundle
│
├── src/                    # Server-side source code (Node.js)
│   ├── config/             # Configuration loading and constants
│   │   ├── index.js        # Loads config (e.g., from .env file, defaults)
│   │   └── mapConstants.js # MAP_WIDTH, MAP_HEIGHT, MAP_SEED, MINE_DENSITY
│   │
│   ├── core/               # Core game logic (agnostic of web/db)
│   │   ├── gameUtils.js    # isMine(), calculateAdjacentMines() functions
│   │   └── gameStateManager.js # Implements revealCell, toggleFlag logic
│   │                         # Uses gameUtils, calls dbInterface methods
│   │
│   ├── db/                 # Database interaction layer (SQLite)
│   │   ├── connection.js   # Sets up and exports the SQLite connection instance
│   │   └── repository.js   # Implements DB methods (getCellStates, updatePlayerScore, etc.)
│   │                         # Contains all SQL queries
│   │
│   ├── network/            # WebSocket and HTTP server implementation
│   │   ├── httpServer.js   # Configures and starts the HTTP server (serves /public)
│   │   └── webSocketServer.js# Manages WebSocket connections, message parsing/sending
│   │                         # Routes incoming messages to controller
│   │
│   ├── controllers/        # Handles incoming requests/messages, orchestrates responses
│   │   └── gameController.js # Processes parsed WebSocket messages (clickCell, flagCell...)
│   │                         # Calls GameStateManager & PlayerManager, formats responses
│   │
│   ├── managers/           # Manages specific runtime states (e.g., connected players)
│   │   └── playerManager.js# Tracks active player sessions, IDs, positions
│   │                         # Handles player join/leave/position updates
│   │
│   └── utils/              # Shared utility functions
│       └── logger.js       # Simple logging utility
│       └── helpers.js      # Any other miscellaneous helper functions
│
├── tests/                  # Directory for automated tests (optional for MVP but recommended)
│   ├── core/               # Unit tests for core game logic
│   └── ...                 # Other test categories (integration, etc.)
│
├── .env                    # Environment variables (PORT, DATABASE_PATH, MAP_SEED) - DO NOT COMMIT
├── .gitignore              # Specifies intentionally untracked files (node_modules, .env, *.db)
├── package.json            # Node.js project metadata and dependencies (ws, sqlite3, dotenv)
├── package-lock.json       # Records exact dependency versions
└── server.js               # Main application entry point
```

**Explanation:**

* **`public/`**: Holds all client-side files. The `httpServer.js` will be configured to serve files from this directory.
* **`src/`**: Contains all the server-side Node.js code.
    * **`config/`**: Centralizes configuration loading (e.g., using `dotenv` to load from `.env`) and constants like map dimensions/seed.
    * **`core/`**: Pure game logic. `gameUtils.js` has the deterministic functions from Step 3. `gameStateManager.js` orchestrates game rule execution, relying on `gameUtils.js` and the `db/repository.js` for persistence.
    * **`db/`**: Isolates database code. `connection.js` manages the SQLite connection pool/instance. `repository.js` provides an abstracted interface for all database operations (CRUD operations on `map_state` and `players`).
    * **`network/`**: Manages client connections. `httpServer.js` serves static files and potentially handles the WebSocket upgrade request. `webSocketServer.js` deals with the WebSocket lifecycle, message serialization/deserialization, and routing messages to the `gameController`.
    * **`controllers/`**: Bridges the network layer and the application logic. `gameController.js` understands the WebSocket API messages and translates them into calls to the appropriate managers.
    * **`managers/`**: Handles runtime state management, like `playerManager.js` keeping track of who is currently connected and their approximate location.
    * **`utils/`**: General-purpose helper functions.
* **`tests/`**: Essential for reliable software; holds automated tests.
* **`.env`**: Used to store sensitive or environment-specific configuration like the `MAP_SEED` and database path. Remember to add this file to `.gitignore`.
* **`package.json`**: Defines the project, its dependencies (like `ws`, `sqlite3`, `dotenv`), and scripts (like `start`, `test`).
* **`server.js`**: The main script that boots the application. It imports modules, initializes the database connection, creates instances of managers and controllers, starts the HTTP and WebSocket servers, and wires everything together.


## TODO / Future Enhancements

This is an MVP. Many features and improvements can be added:

* [ ] **Input Throttling:** Throttle `updatePosition` messages sent from the client.
* [ ] **Zoom:** Implement pinch-to-zoom and mouse wheel zoom.
* [ ] **Improved Visuals:** Use sprites or better styling for cells, flags, mines, players.
* [ ] **Client Optimizations:** Optimize Canvas rendering (e.g., draw diffs).
* [ ] **Error Handling:** More robust error handling and display on the client.
* [ ] **Stun Effect:** Visual feedback when a player is stunned after hitting a mine.
* [ ] **UI Improvements:** Better status indicators, player list, etc.
* [ ] **Viewport Loading:** Dynamically load map chunks as the viewport moves (advanced).
* [ ] **Leaderboards:** Global or time-based high scores.
* [ ] **Achievements/Quests:** Add challenges and rewards.
* [ ] **Power-ups:** Introduce temporary abilities.
* [ ] **Sound Effects:** Add audio feedback.
* [ ] **Testing:** Implement automated unit and integration tests for the server.
* [ ] **Scalability:** Refactor for potential scaling (stateless services where possible - far future).

## Screenshot

![Screenshot](/doc/screenshot_250329_001.png)

## License

This project is licensed under the ISC License - see the LICENSE file for details.