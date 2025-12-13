"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegionTimezone = getRegionTimezone;
exports.todayYYYYMMDD = todayYYYYMMDD;
exports.deadlineDateTime = deadlineDateTime;
exports.minutesUntilDeadline = minutesUntilDeadline;
exports.dateTimeFromYYYYMMDD = dateTimeFromYYYYMMDD;
exports.isProvisionWindow = isProvisionWindow;
exports.getProvisionTimes = getProvisionTimes;
exports.formatForLog = formatForLog;
// src/lib/timezone.ts
const luxon_1 = require("luxon");
/**
 * Get the timezone for the current region from environment
 * Defaults to America/New_York if not set
 */
function getRegionTimezone() {
    return process.env.REGION_TZ || "America/New_York";
}
/**
 * Get current date in YYYYMMDD format for the region timezone
 * @example todayYYYYMMDD() => "20250108"
 */
function todayYYYYMMDD() {
    const tz = getRegionTimezone();
    return luxon_1.DateTime.now().setZone(tz).toFormat("yyyyMMdd");
}
/**
 * Get the 7:00 AM deadline for today in the region timezone
 * @returns DateTime object representing today at 7:00 AM
 */
function deadlineDateTime() {
    const tz = getRegionTimezone();
    return luxon_1.DateTime.now()
        .setZone(tz)
        .set({ hour: 7, minute: 0, second: 0, millisecond: 0 });
}
/**
 * Calculate minutes remaining until 7:00 AM deadline
 * Returns negative if past deadline
 * @returns number of minutes until deadline (negative if past)
 */
function minutesUntilDeadline() {
    const now = luxon_1.DateTime.now().setZone(getRegionTimezone());
    const deadline = deadlineDateTime();
    // If we're past 7 AM today, the deadline is tomorrow
    const targetDeadline = now > deadline ? deadline.plus({ days: 1 }) : deadline;
    const diff = targetDeadline.diff(now, "minutes");
    return Math.floor(diff.minutes);
}
/**
 * Get DateTime for a specific YYYYMMDD date in region timezone
 */
function dateTimeFromYYYYMMDD(yyyymmdd) {
    const tz = getRegionTimezone();
    const year = parseInt(yyyymmdd.substring(0, 4), 10);
    const month = parseInt(yyyymmdd.substring(4, 6), 10);
    const day = parseInt(yyyymmdd.substring(6, 8), 10);
    return luxon_1.DateTime.fromObject({ year, month, day, hour: 0, minute: 0, second: 0 }, { zone: tz });
}
/**
 * Check if we're within the provision window (06:00 - 06:30)
 */
function isProvisionWindow() {
    const now = luxon_1.DateTime.now().setZone(getRegionTimezone());
    const hour = now.hour;
    const minute = now.minute;
    return hour === 6 && minute >= 0 && minute <= 30;
}
/**
 * Get provision times for retries
 */
function getProvisionTimes() {
    const tz = getRegionTimezone();
    const today = luxon_1.DateTime.now().setZone(tz).startOf("day");
    return {
        first: today.set({ hour: 6, minute: 0 }),
        retry1: today.set({ hour: 6, minute: 10 }),
        retry2: today.set({ hour: 6, minute: 20 }),
    };
}
/**
 * Format DateTime for logging
 */
function formatForLog(dt) {
    return dt.toFormat("yyyy-MM-dd HH:mm:ss ZZZ");
}
