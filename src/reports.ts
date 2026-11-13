import type { ParsedArgs } from "./args";
import type { Settings } from "./settings";
import { isWorkday, createHolidayEngine, getHolidayInfo } from "./calendar";
import {
  formatIsoDate,
  pad,
  resolveWeekAnchor,
  resolveMonthAnchor,
  getIsoWeekStart,
  firstDayOfMonth,
  addDays,
  lastDayOfMonth,
  stripTime,
  parseIsoDate,
} from "./dates";
import type { EntryRecord } from "./entries";
import { filterEntryByTags, entryTotal, addEntryTagsToTotals } from "./entries";
import { readEntriesInRange, readAllEntries } from "./storage";
import { runExport } from "./export";
import {
  formatHours,
  printTable,
  printLoggedOnTagLines,
  warningText,
  formatEntryTagSummary,
} from "./output";

interface PeriodContext {
  start: Date;
  end: Date;
  rows: RowInfo[];
  baselineDaily: number;
  loggedTotal: number;
  hoursLeft: number;
  daysLeft: number;
  dynamicExpected: number;
  tagTotals: Map<string, number>;
}

export interface RowInfo {
  date: Date;
  iso: string;
  label: string;
  isWorkday: boolean;
  isHoliday: boolean;
  holidayName?: string;
  holidayType?: string;
  isOptionalHoliday: boolean;
  hasBlockingHoliday: boolean;
  tagSummary?: string;
  loggedHours?: number;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function runReport(
  action: "week" | "month",
  parsed: ParsedArgs,
  settings: Settings,
): void {
  const context = buildPeriodContext(action, parsed, settings);
  if (parsed.exportOptions?.enabled) {
    runExport(parsed.exportOptions, context.rows, context.baselineDaily);
    return;
  }

  const {
    start,
    end,
    rows,
    baselineDaily,
    loggedTotal,
    daysLeft,
    dynamicExpected,
    tagTotals,
    hoursLeft,
  } = context;

  const title =
    action === "week"
      ? `Week ${formatIsoDate(start)} to ${formatIsoDate(end)}`
      : `Month ${start.getFullYear()}-${pad(start.getMonth() + 1)}`;
  console.log(title);
  console.log("");

  const hoursByRow = rows.map((row) => {
    if (row.loggedHours !== undefined) {
      return formatHours(row.loggedHours);
    }
    if (!row.isWorkday) {
      return "0";
    }
    if (row.hasBlockingHoliday) {
      return formatHours(baselineDaily);
    }
    return formatHours(dynamicExpected);
  });
  printTable(rows, hoursByRow);

  console.log("");
  console.log(`Total logged: ${formatHours(loggedTotal)}`);
  printLoggedOnTagLines(tagTotals);
  console.log(`Hours left: ${formatHours(hoursLeft)}`);
  console.log(
    `Expected/day (remaining): ${daysLeft > 0 ? formatHours(dynamicExpected) : "n/a"}`,
  );
  if (action === "week") {
    console.log(
      warningText(
        "Warning: Estimates are based on weekly hours only. Use -m for monthly estimates.",
      ),
    );
  }
}

export function runExportAll(parsed: ParsedArgs, settings: Settings): void {
  if (!parsed.exportOptions?.enabled) {
    throw new Error("Export options are required for -x export-all.");
  }

  const rows = buildExportAllRows(parsed, settings);
  const baselineDaily = settings.weeklyHours / settings.workdaysPerWeek;
  runExport(parsed.exportOptions, rows, baselineDaily);
}

function buildPeriodContext(
  action: "week" | "month",
  parsed: ParsedArgs,
  settings: Settings,
): PeriodContext {
  const offset = parsed.offset ?? 0;
  const anchor =
    action === "week"
      ? resolveWeekAnchor(parsed.dateArg, offset)
      : resolveMonthAnchor(parsed.dateArg, offset);

  const start =
    action === "week" ? getIsoWeekStart(anchor) : firstDayOfMonth(anchor);
  const end = action === "week" ? addDays(start, 6) : lastDayOfMonth(anchor);
  const holidayEngine = createHolidayEngine(settings);
  const entries = readEntriesInRange(start, end);

  const baselineDaily = settings.weeklyHours / settings.workdaysPerWeek;
  const rows: RowInfo[] = [];
  const tagTotals = new Map<string, number>();

  let loggedTotal = 0;
  let periodTarget = 0;

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = stripTime(cursor);
    const iso = formatIsoDate(date);
    const entry = entries.get(iso);
    const filteredEntry = entry
      ? filterEntryByTags(entry, parsed.tagFilters)
      : undefined;
    const row = buildRow(date, iso, filteredEntry, settings, holidayEngine);
    rows.push(row);

    if (filteredEntry && row.loggedHours !== undefined) {
      loggedTotal += row.loggedHours;
      addEntryTagsToTotals(tagTotals, filteredEntry);
    }
    if (row.isWorkday) {
      periodTarget += baselineDaily;
    }
  }

  const creditedTotal = rows.reduce(
    (total, row) => total + getCreditedHours(row, baselineDaily),
    0,
  );
  const hoursLeft = periodTarget - creditedTotal;
  const daysLeft = rows.filter(
    (row) =>
      row.loggedHours === undefined &&
      row.isWorkday &&
      !row.hasBlockingHoliday,
  ).length;
  const dynamicExpected = daysLeft > 0 ? hoursLeft / daysLeft : 0;

  return {
    start,
    end,
    rows,
    baselineDaily,
    loggedTotal,
    hoursLeft,
    daysLeft,
    dynamicExpected,
    tagTotals,
  };
}

function getCreditedHours(row: RowInfo, baselineDaily: number): number {
  if (row.loggedHours !== undefined) {
    return row.loggedHours;
  }
  if (row.isWorkday && row.hasBlockingHoliday) {
    return baselineDaily;
  }
  return 0;
}

function buildExportAllRows(parsed: ParsedArgs, settings: Settings): RowInfo[] {
  const allEntries = readAllEntries(parsed.tagFilters);
  if (allEntries.length === 0) {
    return [];
  }

  const firstDate = parseIsoDate(allEntries[0].iso);
  const lastDate = parseIsoDate(allEntries[allEntries.length - 1].iso);
  if (!firstDate || !lastDate) {
    return [];
  }

  const holidayEngine = createHolidayEngine(settings);
  const byIso = new Map(allEntries.map((entry) => [entry.iso, entry]));

  const rows: RowInfo[] = [];
  for (let cursor = firstDate; cursor <= lastDate; cursor = addDays(cursor, 1)) {
    const date = stripTime(cursor);
    const iso = formatIsoDate(date);
    rows.push(buildRow(date, iso, byIso.get(iso), settings, holidayEngine));
  }

  return rows;
}

export function runAll(parsed: ParsedArgs, settings: Settings): void {
  const entries = readAllEntries(parsed.tagFilters);
  const holidayEngine = createHolidayEngine(settings);
  const rows: RowInfo[] = [];
  const tagTotals = new Map<string, number>();
  let totalHours = 0;

  for (const entry of entries) {
    const date = parseIsoDate(entry.iso);
    if (!date) {
      continue;
    }
    rows.push(buildRow(date, entry.iso, entry, settings, holidayEngine));
    totalHours += entryTotal(entry);
    addEntryTagsToTotals(tagTotals, entry);
  }

  console.log("All entries");
  console.log("");

  if (rows.length === 0) {
    console.log("No entries found.");
    return;
  }

  printTable(rows, rows.map((row) => formatHours(row.loggedHours ?? 0)));

  console.log("");
  console.log(`Total logged: ${formatHours(totalHours)}`);
  printLoggedOnTagLines(tagTotals);
}

function buildRow(
  date: Date,
  iso: string,
  entry: EntryRecord | undefined,
  settings: Settings,
  holidayEngine: ReturnType<typeof createHolidayEngine>,
): RowInfo {
  const holiday = getHolidayInfo(holidayEngine, date);
  const holidayLabel = holiday.isHoliday ? ` (${holiday.name ?? "Holiday"})` : "";
  return {
    date,
    iso,
    label: `${WEEKDAY_SHORT[date.getDay()]} ${iso}${holidayLabel}`,
    isWorkday: isWorkday(date.getDay(), settings),
    isHoliday: holiday.isHoliday,
    holidayName: holiday.name,
    holidayType: holiday.type,
    isOptionalHoliday: holiday.isOptionalHoliday,
    hasBlockingHoliday: holiday.hasBlockingHoliday,
    tagSummary: formatEntryTagSummary(entry),
    loggedHours: entry ? entryTotal(entry) : undefined,
  };
}
