const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18;
const BUSINESS_HOURS_PER_DAY = BUSINESS_END_HOUR - BUSINESS_START_HOUR;

function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function clampToBusinessHours(date: Date): Date {
  const clamped = new Date(date);
  if (clamped.getHours() < BUSINESS_START_HOUR) {
    clamped.setHours(BUSINESS_START_HOUR, 0, 0, 0);
  } else if (clamped.getHours() >= BUSINESS_END_HOUR) {
    clamped.setHours(BUSINESS_END_HOUR, 0, 0, 0);
  }
  return clamped;
}

export function businessMinutesBetween(start: Date, end: Date): number {
  if (end <= start) return 0;

  let totalMinutes = 0;
  const cursor = new Date(start);

  while (cursor < end) {
    if (!isBusinessDay(cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(BUSINESS_START_HOUR, 0, 0, 0);
      continue;
    }

    const dayStart = clampToBusinessHours(cursor);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(BUSINESS_END_HOUR, 0, 0, 0);

    if (dayStart >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(BUSINESS_START_HOUR, 0, 0, 0);
      continue;
    }

    const sliceEnd = end < dayEnd ? end : dayEnd;
    if (sliceEnd > dayStart) {
      totalMinutes += (sliceEnd.getTime() - dayStart.getTime()) / 60000;
    }

    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(BUSINESS_START_HOUR, 0, 0, 0);
  }

  return Math.floor(totalMinutes);
}

export function businessHoursBetween(start: Date, end: Date): number {
  return businessMinutesBetween(start, end) / 60;
}

export { BUSINESS_HOURS_PER_DAY, BUSINESS_START_HOUR, BUSINESS_END_HOUR };
