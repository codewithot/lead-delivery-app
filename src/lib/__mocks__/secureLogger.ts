const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    withCorrelationId: jest.fn(),
};
// Circular reference
mockLogger.withCorrelationId.mockReturnValue(mockLogger);

export const createLogger = jest.fn(() => mockLogger);
export const generateCorrelationId = jest.fn(() => 'test-correlation-id');
export const logger = mockLogger;
