import {
  createLogger,
  safeContact,
  safeProperty,
  sanitize
} from '../lib/secureLogger';

const logger = createLogger('SecurityTest');

// Test 1: Password redaction
logger.info('\n=== Test 1: Password Redaction ===');
const userWithPassword = {
  id: '123',
  email: 'test@example.com',
  password: 'SuperSecret123!',
  accessToken: 'Bearer abc123xyz',
};
logger.info('Raw object:', userWithPassword);
logger.info('Sanitized:', sanitize(userWithPassword));

// Test 2: Email truncation
logger.info('\n=== Test 2: Email Truncation ===');
const contact = {
  id: 456,
  email: 'john.doe@example.com',
  phone: '+1-555-123-4567',
  firstName: 'John',
  lastName: 'Doe',
};
logger.info('Raw contact:', contact);
logger.info('Safe contact:', safeContact(contact));

// Test 3: Address truncation
logger.info('\n=== Test 3: Address Truncation ===');
const property = {
  id: 789,
  addressFull: '123 Main Street, Apartment 4B, Springfield, IL 62701',
  price: 250000,
};
logger.info('Raw property:', property);
logger.info('Safe property:', safeProperty(property));

// Test 4: ID masking
logger.info('\n=== Test 4: ID Masking ===');
const account = {
  provider: 'gh',
  providerAccountId: 'ghlacc_1234567890abcdef',
  access_token: 'secret_token_here',
};
logger.info('Raw account:', account);
logger.info('Sanitized account:', sanitize(account));

logger.info('\n✅ All tests completed. Review output above.');
