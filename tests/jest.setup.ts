// Global test setup
import { DateTime } from 'luxon';

// Set test environment - prevents workers from starting
Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: true });

// Set timezone for consistent test results
process.env.TZ = 'UTC';
process.env.REGION_TZ = 'America/New_York';

// Disable Redis rate limiter in tests
process.env.RATE_LIMIT_ENABLED = 'false';

console.log('🧪 Jest test environment initialized (NODE_ENV=test)');

// Extend Jest matchers if needed
expect.extend({
    toBeWithinRange(received: number, floor: number, ceiling: number) {
        const pass = received >= floor && received <= ceiling;
        if (pass) {
            return {
                message: () =>
                    `expected ${received} not to be within range ${floor} - ${ceiling}`,
                pass: true,
            };
        } else {
            return {
                message: () =>
                    `expected ${received} to be within range ${floor} - ${ceiling}`,
                pass: false,
            };
        }
    },
});

// Declare custom matchers
declare global {
    namespace jest {
        interface Matchers<R> {
            toBeWithinRange(floor: number, ceiling: number): R;
        }
    }
}
