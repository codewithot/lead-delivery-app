// src/lib/timezone.ts
import { DateTime } from "luxon";

/**
 * Get the timezone for the current region from environment
 * Defaults to America/New_York if not set
 */
export function getRegionTimezone(): string {
  return process.env.REGION_TZ || "America/New_York";
}

/**
 * Get current date in YYYYMMDD format for the region timezone
 * @example todayYYYYMMDD() => "20250108"
 */
export function todayYYYYMMDD(): string {
  const tz = getRegionTimezone();
  return DateTime.now().setZone(tz).toFormat("yyyyMMdd");
}

/**
 * Get the 7:00 AM deadline for today in the region timezone
 * @returns DateTime object representing today at 7:00 AM
 */
export function deadlineDateTime(): DateTime {
  const tz = getRegionTimezone();
  return DateTime.now()
    .setZone(tz)
    .set({ hour: 7, minute: 0, second: 0, millisecond: 0 });
}

/**
 * Calculate minutes remaining until 7:00 AM deadline
 * Returns negative if past deadline
 * @returns number of minutes until deadline (negative if past)
 */
export function minutesUntilDeadline(): number {
  const now = DateTime.now().setZone(getRegionTimezone());
  const deadline = deadlineDateTime();

  // Calculate diff directly - will be negative if we are past the deadline
  const diff = deadline.diff(now, "minutes");
  return Math.floor(diff.minutes);
}

/**
 * Get DateTime for a specific YYYYMMDD date in region timezone
 */
export function dateTimeFromYYYYMMDD(yyyymmdd: string): DateTime {
  const tz = getRegionTimezone();
  const year = parseInt(yyyymmdd.substring(0, 4), 10);
  const month = parseInt(yyyymmdd.substring(4, 6), 10);
  const day = parseInt(yyyymmdd.substring(6, 8), 10);

  return DateTime.fromObject(
    { year, month, day, hour: 0, minute: 0, second: 0 },
    { zone: tz }
  );
}

/**
 * Check if we're within the provision window (06:00 - 06:30)
 */
export function isProvisionWindow(): boolean {
  const now = DateTime.now().setZone(getRegionTimezone());
  const hour = now.hour;
  const minute = now.minute;

  return hour === 6 && minute >= 0 && minute <= 30;
}

/**
 * Get provision times for retries
 */
export function getProvisionTimes(): {
  first: DateTime;
  retry1: DateTime;
  retry2: DateTime;
} {
  const tz = getRegionTimezone();
  const today = DateTime.now().setZone(tz).startOf("day");

  return {
    first: today.set({ hour: 6, minute: 0 }),
    retry1: today.set({ hour: 6, minute: 10 }),
    retry2: today.set({ hour: 6, minute: 20 }),
  };
}

/**
 * Format DateTime for logging
 */
export function formatForLog(dt: DateTime): string {
  return dt.toFormat("yyyy-MM-dd HH:mm:ss ZZZ");
}
