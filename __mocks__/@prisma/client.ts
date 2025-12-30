const mockModel = {
    create: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
};

const mockPrisma = {
    webhookLog: mockModel,
    user: mockModel,
    property: mockModel,
    job: mockModel,
    $disconnect: jest.fn(),
};

export const PrismaClient = jest.fn(() => mockPrisma);
export const Prisma = {
    InputJsonValue: {},
};
export const prisma = mockPrisma; // Export instance for restoration
