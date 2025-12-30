import {
    todayYYYYMMDD,
    minutesUntilDeadline,
    deadlineDateTime,
    getRegionTimezone,
    dateTimeFromYYYYMMDD,
    isProvisionWindow,
    getProvisionTimes,
    formatForLog
} from '@/lib/timezone';
import { DateTime } from 'luxon';
import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';

describe('Timezone Functions', () => {
    // Save original environment
    const originalEnv = process.env;

    beforeEach(() => {
        // Reset environment before each test
        process.env = { ...originalEnv, REGION_TZ: 'America/New_York' };
    });

    afterEach(() => {
        // Restore original environment
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    describe('getRegionTimezone', () => {
        test('returns timezone from environment variable', () => {
            process.env.REGION_TZ = 'America/Chicago';
            expect(getRegionTimezone()).toBe('America/Chicago');
        });

        test('defaults to America/New_York when not set', () => {
            delete process.env.REGION_TZ;
            expect(getRegionTimezone()).toBe('America/New_York');
        });
    });

    describe('todayYYYYMMDD', () => {
        test('returns correct YYYYMMDD format', () => {
            const result = todayYYYYMMDD();
            expect(result).toMatch(/^\d{8}$/); // YYYYMMDD format
            expect(result.length).toBe(8);
        });

        test('returns valid date components', () => {
            const result = todayYYYYMMDD();
            const year = parseInt(result.substring(0, 4), 10);
            const month = parseInt(result.substring(4, 6), 10);
            const day = parseInt(result.substring(6, 8), 10);

            expect(year).toBeGreaterThanOrEqual(2025);
            expect(month).toBeGreaterThanOrEqual(1);
            expect(month).toBeLessThanOrEqual(12);
            expect(day).toBeGreaterThanOrEqual(1);
            expect(day).toBeLessThanOrEqual(31);
        });

        test('respects timezone setting', () => {
            // Mock specific time
            const mockDate = DateTime.fromObject(
                { year: 2025, month: 1, day: 15, hour: 23, minute: 30 },
                { zone: 'UTC' }
            );
            jest.spyOn(DateTime, 'now').mockReturnValue(mockDate as unknown as DateTime);

            // UTC: 2025-01-15 23:30
            // EST: 2025-01-15 18:30 (still same day)
            const result = todayYYYYMMDD();
            expect(result).toBe('20250115');
        });
    });

    describe('deadlineDateTime', () => {
        test('is set at 7:00 AM in region timezone', () => {
            const deadline = deadlineDateTime();
            expect(deadline.hour).toBe(7);
            expect(deadline.minute).toBe(0);
            expect(deadline.second).toBe(0);
            expect(deadline.millisecond).toBe(0);
            expect(deadline.zone.name).toBe('America/New_York');
        });

        test('returns DateTime for current day', () => {
            const now = DateTime.now().setZone('America/New_York');
            const deadline = deadlineDateTime();

            expect(deadline.year).toBe(now.year);
            expect(deadline.month).toBe(now.month);
            expect(deadline.day).toBe(now.day);
        });
    });

    describe('minutesUntilDeadline', () => {
        test('calculates correctly before deadline', () => {
            const now = DateTime.fromObject(
                { year: 2025, month: 1, day: 15, hour: 6, minute: 30 },
                { zone: 'America/New_York' }
            );

            jest.spyOn(DateTime, 'now').mockReturnValue(now as unknown as DateTime);

            const minutes = minutesUntilDeadline();
            expect(minutes).toBe(30); // 30 minutes until 7:00 AM
        });

        test('returns negative value after deadline', () => {
            const now = DateTime.fromObject(
                { year: 2025, month: 1, day: 15, hour: 8, minute: 0 },
                { zone: 'America/New_York' }
            );

            jest.spyOn(DateTime, 'now').mockReturnValue(now as unknown as DateTime);

            const minutes = minutesUntilDeadline();
            expect(minutes).toBeLessThan(0);
        });

        test('calculates for next day when past deadline', () => {
            const now = DateTime.fromObject(
                { year: 2025, month: 1, day: 15, hour: 20, minute: 0 },
                { zone: 'America/New_York' }
            );

            jest.spyOn(DateTime, 'now').mockReturnValue(now as unknown as DateTime);

            const minutes = minutesUntilDeadline();
            // Should be negative (past deadline)
            expect(minutes).toBeLessThan(0);
            expect(minutes).toBe(-780); // 13 hours past 7 AM = 780 minutes
        });

        test('returns 0 at exact deadline time', () => {
            const now = DateTime.fromObject(
                { year: 2025, month: 1, day: 15, hour: 7, minute: 0, second: 0 },
                { zone: 'America/New_York' }
            );

            jest.spyOn(DateTime, 'now').mockReturnValue(now as unknown as DateTime);

            const minutes = minutesUntilDeadline();
            expect(minutes).toBe(0);
        });
    });

    describe('dateTimeFromYYYYMMDD', () => {
        test('parses valid YYYYMMDD string correctly', () => {
            const result = dateTimeFromYYYYMMDD('20250115');

            expect(result.year).toBe(2025);
            expect(result.month).toBe(1);
            expect(result.day).toBe(15);
            expect(result.hour).toBe(0);
            expect(result.minute).toBe(0);
            expect(result.second).toBe(0);
        });

        test('sets timezone correctly', () => {
            const result = dateTimeFromYYYYMMDD('20250115');
            expect(result.zone.name).toBe('America/New_York');
        });

        test('handles different dates', () => {
            const testCases = [
                { input: '20251231', year: 2025, month: 12, day: 31 },
                { input: '20250101', year: 2025, month: 1, day: 1 },
                { input: '20250630', year: 2025, month: 6, day: 30 },
            ];

            testCases.forEach(({ input, year, month, day }) => {
                const result = dateTimeFromYYYYMMDD(input);
                expect(result.year).toBe(year);
                expect(result.month).toBe(month);
                expect(result.day).toBe(day);
            });
        });
    });

    describe('isProvisionWindow', () => {
        test('returns true within provision window (06:00-06:30)', () => {
            const testTimes = [
                { hour: 6, minute: 0 },
                { hour: 6, minute: 15 },
                { hour: 6, minute: 30 },
            ];

            testTimes.forEach(({ hour, minute }) => {
                const now = DateTime.fromObject(
                    { year: 2025, month: 1, day: 15, hour, minute },
                    { zone: 'America/New_York' }
                );
                jest.spyOn(DateTime, 'now').mockReturnValue(now as unknown as DateTime);

                expect(isProvisionWindow()).toBe(true);
            });
        });

        test('returns false outside provision window', () => {
            const testTimes = [
                { hour: 5, minute: 59 },
                { hour: 6, minute: 31 },
                { hour: 7, minute: 0 },
                { hour: 12, minute: 0 },
            ];

            testTimes.forEach(({ hour, minute }) => {
                const now = DateTime.fromObject(
                    { year: 2025, month: 1, day: 15, hour, minute },
                    { zone: 'America/New_York' }
                );
                jest.spyOn(DateTime, 'now').mockReturnValue(now as unknown as DateTime);

                expect(isProvisionWindow()).toBe(false);
            });
        });
    });

    describe('getProvisionTimes', () => {
        test('returns correct provision schedule', () => {
            const times = getProvisionTimes();

            expect(times.first.hour).toBe(6);
            expect(times.first.minute).toBe(0);

            expect(times.retry1.hour).toBe(6);
            expect(times.retry1.minute).toBe(10);

            expect(times.retry2.hour).toBe(6);
            expect(times.retry2.minute).toBe(20);
        });

        test('all times are for current day', () => {
            const now = DateTime.now().setZone('America/New_York');
            const times = getProvisionTimes();

            expect(times.first.day).toBe(now.day);
            expect(times.retry1.day).toBe(now.day);
            expect(times.retry2.day).toBe(now.day);
        });

        test('times are in correct timezone', () => {
            const times = getProvisionTimes();

            expect(times.first.zone.name).toBe('America/New_York');
            expect(times.retry1.zone.name).toBe('America/New_York');
            expect(times.retry2.zone.name).toBe('America/New_York');
        });
    });

    describe('formatForLog', () => {
        test('formats DateTime for logging with timezone', () => {
            const dt = DateTime.fromObject(
                { year: 2025, month: 1, day: 15, hour: 14, minute: 30, second: 45 },
                { zone: 'America/New_York' }
            );

            const result = formatForLog(dt);

            // Should include date, time, and timezone
            expect(result).toContain('2025-01-15');
            expect(result).toContain('14:30:45');
            // Format uses ZZZ which is offset like -0500 or abbreviated timezone name
            expect(result).toMatch(/(\-\d{4})|(EST|EDT)/);
        });

        test('handles different timezones', () => {
            const dt = DateTime.fromObject(
                { year: 2025, month: 6, day: 15, hour: 12, minute: 0, second: 0 },
                { zone: 'America/Los_Angeles' }
            );

            const result = formatForLog(dt);
            expect(result).toContain('2025-06-15');
            expect(result).toContain('12:00:00');
        });
    });
});
