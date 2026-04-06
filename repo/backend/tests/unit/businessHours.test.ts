import { businessMinutesBetween, businessHoursBetween } from "../../src/utils/businessHours";

describe("businessMinutesBetween", () => {
  test("returns 0 when end is before start", () => {
    const start = new Date("2026-03-30T10:00:00");
    const end = new Date("2026-03-30T09:00:00");
    expect(businessMinutesBetween(start, end)).toBe(0);
  });

  test("counts minutes within a single business day", () => {
    const start = new Date("2026-03-30T09:00:00"); // Monday 9am
    const end = new Date("2026-03-30T12:00:00");   // Monday 12pm
    expect(businessMinutesBetween(start, end)).toBe(180);
  });

  test("clamps start before business hours to 8am", () => {
    const start = new Date("2026-03-30T06:00:00"); // Monday 6am
    const end = new Date("2026-03-30T09:00:00");   // Monday 9am
    expect(businessMinutesBetween(start, end)).toBe(60); // 8am-9am only
  });

  test("clamps end after business hours to 6pm", () => {
    const start = new Date("2026-03-30T17:00:00"); // Monday 5pm
    const end = new Date("2026-03-30T20:00:00");   // Monday 8pm
    expect(businessMinutesBetween(start, end)).toBe(60); // 5pm-6pm only
  });

  test("skips weekends entirely", () => {
    const friday5pm = new Date("2026-03-27T17:00:00"); // Friday 5pm
    const monday9am = new Date("2026-03-30T09:00:00"); // Monday 9am
    expect(businessMinutesBetween(friday5pm, monday9am)).toBe(120); // Fri 5pm-6pm (60m) + Mon 8am-9am (60m)
  });

  test("returns 0 for entirely weekend range", () => {
    const satMorning = new Date("2026-03-28T10:00:00"); // Saturday
    const sunEvening = new Date("2026-03-29T18:00:00"); // Sunday
    expect(businessMinutesBetween(satMorning, sunEvening)).toBe(0);
  });

  test("handles multi-day spanning correctly", () => {
    const monMorning = new Date("2026-03-30T08:00:00"); // Monday 8am
    const wedNoon = new Date("2026-04-01T12:00:00");    // Wednesday 12pm
    // Mon: 10h, Tue: 10h, Wed: 4h = 24h = 1440m
    expect(businessMinutesBetween(monMorning, wedNoon)).toBe(1440);
  });

  test("returns 0 when start is after business hours", () => {
    const start = new Date("2026-03-30T19:00:00"); // Monday 7pm
    const end = new Date("2026-03-30T21:00:00");   // Monday 9pm
    expect(businessMinutesBetween(start, end)).toBe(0);
  });
});

describe("businessHoursBetween", () => {
  test("converts minutes to hours", () => {
    const start = new Date("2026-03-30T08:00:00");
    const end = new Date("2026-03-30T18:00:00");
    expect(businessHoursBetween(start, end)).toBe(10);
  });
});
