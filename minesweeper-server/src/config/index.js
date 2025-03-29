require('dotenv').config();

const config = {
    port: parseInt(process.env.PORT, 10) || 8080,
    databasePath: process.env.DATABASE_PATH || './database.db',
    mapSeed: process.env.MAP_SEED || 'default_insecure_seed', // Fallback, but .env is preferred
};

if (config.mapSeed === 'default_insecure_seed' || config.mapSeed === 'ReplaceWithYourOwnSecretSeedValue!') {
    console.warn('WARNING: Using default or placeholder MAP_SEED. Please set a unique MAP_SEED in your .env file!');
}

module.exports = config;