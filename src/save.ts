import type { ParsedArgs } from "./args";
import type { Settings } from "./settings";
import { describeWorkweek } from "./settings";
import { createHolidayEngine, isWorkday, getHolidayInfo } from "./calendar";
import { resolveSaveAnchor, formatIsoDate, addDays } from "./dates";
import type { EntryRecord } from "./entries";
import { entryTotal } from "./entries";
import { clearEntry, writeEntry } from "./storage";
import { warningText, formatHours } from "./output";

export function runSave(parsed: ParsedArgs, settings: Settings): void {
  if (!parsed.saveValues || parsed.saveValues.length === 0) {
    throw new Error("No values provided for -s/-save.");
  }

  const offset = parsed.offset ?? 0;
  const saveTags = parsed.tagFilters;
  const anchor = resolveSaveAnchor(parsed.dateArg, offset);
  const holidayEngine = createHolidayEngine(settings);

  if (parsed.saveValues.length === 1) {
    const target = anchor;
    const value = parsed.saveValues[0];
    const workday = isWorkday(target.getDay(), settings);
    const holiday = getHolidayInfo(holidayEngine, target);

    if (!workday && value > 0) {
      console.warn(
        warningText(
          `Warning: ${formatIsoDate(target)} is outside workweek ${describeWorkweek(settings)}.`,
        ),
      );
    }
    if (holiday.hasBlockingHoliday && value > 0) {
      const suffix = holiday.name ? ` (${holiday.name})` : "";
      const kind = holiday.type ?? "holiday";
      console.warn(
        warningText(
          `Warning: ${formatIsoDate(target)} is a ${kind} holiday${suffix}.`,
        ),
      );
    }

    applySaveValue(target, value, saveTags);
    return;
  }

  let cursor = anchor;
  for (const hours of parsed.saveValues) {
    let guard = 0;
    while (true) {
      const workday = isWorkday(cursor.getDay(), settings);
      const holiday = getHolidayInfo(holidayEngine, cursor);
      if (workday && !holiday.hasBlockingHoliday) {
        break;
      }
      cursor = addDays(cursor, 1);
      guard += 1;
      if (guard > 3700) {
        throw new Error(
          "Unable to find eligible workday while processing -s values.",
        );
      }
    }

    applySaveValue(cursor, hours, saveTags);
    cursor = addDays(cursor, 1);
  }
}

function applySaveValue(
  date: Date,
  value: number,
  tags: string[] | undefined,
): void {
  if (value === 0) {
    const oldValue = clearEntry(date, tags);
    printClearResult(date, oldValue);
    return;
  }
  const result = writeEntry(date, value, tags);
  printWriteResult(date, result.newValue, result.oldValue);
}

function printWriteResult(
  date: Date,
  newValue: EntryRecord,
  oldValue: EntryRecord | undefined,
): void {
  const iso = formatIsoDate(date);
  const newHours = entryTotal(newValue);
  if (oldValue === undefined) {
    console.log(`Saved ${formatHours(newHours)}h on ${iso}.`);
    return;
  }
  console.log(
    `Updated ${iso}: ${formatHours(entryTotal(oldValue))}h -> ${formatHours(newHours)}h.`,
  );
}

function printClearResult(date: Date, oldValue: EntryRecord | undefined): void {
  const iso = formatIsoDate(date);
  if (oldValue === undefined) {
    console.log(`No entry to clear on ${iso}.`);
    return;
  }
  console.log(`Cleared ${formatHours(entryTotal(oldValue))}h entry on ${iso}.`);
}
