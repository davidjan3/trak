export const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

export function resolveSaveAnchor(
  dateArg: string | undefined,
  offset: number,
): Date {
  const base = dateArg ? parseDateArg(dateArg) : today();
  if (!base) {
    throw new Error(
      `Invalid -d/-date for save: "${dateArg}". Use YYYY-MM-DD, DD.MM.YYYY, DD.MM., MM/DD/YYYY, or MM/DD.`,
    );
  }
  return addDays(base, offset);
}

export function resolveWeekAnchor(
  dateArg: string | undefined,
  offset: number,
): Date {
  let base: Date;
  if (!dateArg) {
    base = today();
  } else if (/^\d{1,2}$/.test(dateArg.trim())) {
    const week = Number(dateArg.trim());
    const year = today().getFullYear();
    const maxWeeks = weeksInIsoYear(year);
    if (week < 1 || week > maxWeeks) {
      throw new Error(
        `Week number must be between 1 and ${maxWeeks} for ${year}.`,
      );
    }
    base = isoWeekStartFromYearWeek(year, week);
  } else {
    const parsedDate = parseDateArg(dateArg);
    if (!parsedDate) {
      throw new Error(
        `Invalid -d/-date for week: "${dateArg}". Use week number, YYYY-MM-DD, DD.MM.YYYY, DD.MM., MM/DD/YYYY, or MM/DD.`,
      );
    }
    base = parsedDate;
  }
  return addDays(base, offset * 7);
}

export function resolveMonthAnchor(
  dateArg: string | undefined,
  offset: number,
): Date {
  const base = dateArg ? parseMonthDateArg(dateArg) : today();
  if (!base) {
    throw new Error(
      `Invalid -d/-date for month: "${dateArg}". Use month name, 1..12, MM.YYYY, YYYY-MM-DD, DD.MM.YYYY, DD.MM., MM/DD/YYYY, or MM/DD.`,
    );
  }
  const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + offset, 1);
}

function parseDateArg(raw: string): Date | null {
  return (
    parseIsoDate(raw) ??
    parseDotDateFull(raw) ??
    parseDotDateNoYear(raw) ??
    parseSlashDateFull(raw) ??
    parseSlashDateNoYear(raw)
  );
}

function parseMonthDateArg(raw: string): Date | null {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (MONTH_NAME_TO_INDEX[lower] !== undefined) {
    return new Date(today().getFullYear(), MONTH_NAME_TO_INDEX[lower], 1);
  }

  if (/^\d{1,2}$/.test(trimmed)) {
    const month = Number(trimmed);
    if (month >= 1 && month <= 12) {
      return new Date(today().getFullYear(), month - 1, 1);
    }
  }

  const monthYear = parseMonthYear(trimmed);
  if (monthYear) {
    return new Date(monthYear.year, monthYear.month - 1, 1);
  }

  return parseDateArg(trimmed);
}

function parseMonthYear(raw: string): { month: number; year: number } | null {
  const match = raw.match(/^(\d{1,2})\.(\d{4})$/);
  if (!match) {
    return null;
  }
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }
  return { month, year };
}

export function parseIsoDate(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return createDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseDotDateFull(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) {
    return null;
  }
  return createDate(Number(match[3]), Number(match[2]), Number(match[1]));
}

function parseDotDateNoYear(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (!match) {
    return null;
  }
  const year = today().getFullYear();
  return createDate(year, Number(match[2]), Number(match[1]));
}

function parseSlashDateFull(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  return createDate(Number(match[3]), Number(match[1]), Number(match[2]));
}

function parseSlashDateNoYear(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const year = today().getFullYear();
  return createDate(year, Number(match[1]), Number(match[2]));
}

function createDate(
  year: number,
  monthOneBased: number,
  day: number,
): Date | null {
  if (monthOneBased < 1 || monthOneBased > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(year, monthOneBased - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthOneBased - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return stripTime(date);
}

function weeksInIsoYear(year: number): number {
  return isoWeekNumber(new Date(year, 11, 28));
}

function isoWeekStartFromYearWeek(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const week1Start = getIsoWeekStart(jan4);
  return addDays(week1Start, (week - 1) * 7);
}

function isoWeekNumber(date: Date): number {
  const d = stripTime(date);
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604800000);
}

export function getIsoWeekStart(date: Date): Date {
  const d = stripTime(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function firstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function lastDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function today(): Date {
  return stripTime(new Date());
}

export function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const out = stripTime(date);
  out.setDate(out.getDate() + days);
  return out;
}

export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}
