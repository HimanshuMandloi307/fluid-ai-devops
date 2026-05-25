const express = require('express');
const redis = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;
const REDIS_HOST = process.env.REDIS_HOST || 'redis-service';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

let redisClient;
let isRedisConnected = false;

async function connectRedis() {
  redisClient = redis.createClient({
    socket: {
      host: REDIS_HOST,
      port: parseInt(REDIS_PORT),
      connectTimeout: 5000,
    }
  });

  redisClient.on('error', (err) => {
    console.error('Redis error:', err.message);
    isRedisConnected = false;
  });

  redisClient.on('connect', () => {
    console.log('Redis connected successfully');
    isRedisConnected = true;
  });

  await redisClient.connect();
}

// Liveness probe - just checks if the process is alive
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

// Readiness probe - checks if app is ready to serve traffic (Redis must be connected)
app.get('/ready', (req, res) => {
  if (isRedisConnected) {
    res.status(200).json({ status: 'ready', redis: 'connected' });
  } else {
    res.status(503).json({ status: 'not ready', redis: 'disconnected' });
  }
});

// Main endpoint - increments a visit counter in Redis
app.get('/', async (req, res) => {
  try {
    const visits = await redisClient.incr('visit_count');
    res.json({
      message: 'Hello from Fluid AI DevOps Challenge!',
      visits: visits,
      hostname: process.env.HOSTNAME || 'unknown',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Redis operation failed', detail: err.message });
  }
});

// Info endpoint
app.get('/info', (req, res) => {
  res.json({
    app: 'fluid-ai-devops',
    version: '1.0.0',
    redis_host: REDIS_HOST,
    redis_port: REDIS_PORT,
    redis_connected: isRedisConnected,
    node_version: process.version,
    uptime_seconds: Math.floor(process.uptime())
  });
});

async function start() {
  try {
    await connectRedis();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Redis connecting to ${REDIS_HOST}:${REDIS_PORT}`);
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();
