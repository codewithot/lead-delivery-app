import Redis from 'ioredis';

// Use specific variables from your .env.production
const config = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '19777', 10),
  password: process.env.REDIS_PASSWORD,
  // Change this to undefined to test if the port is non-TLS
  tls: undefined,
  retryStrategy: (times) => Math.min(times * 100, 2000),
};

console.log(`🔄 Connecting to Redis at ${config.host}:${config.port}...`);
console.log(`🔒 TLS: ${config.tls ? 'Enabled' : 'Disabled'}`);
console.log(`🔑 Auth: ${config.password ? 'Password Provided' : 'No Password'}`);

const redis = new Redis(config);

redis.on('connect', () => console.log('✅ Socket connected'));
redis.on('ready', () => console.log('✅ Redis is ready'));
redis.on('error', (err) => console.error('❌ Redis Error:', err.message));

try {
  const result = await redis.ping();
  console.log('✅ PING Result:', result);

  await redis.set('antigravity_test', 'success');
  const val = await redis.get('antigravity_test');
  console.log('✅ Data Test:', val === 'success' ? 'SUCCESS' : 'FAILURE');
} catch (err) {
  console.error('❌ Test failed:', err.message);
} finally {
  redis.disconnect();
}