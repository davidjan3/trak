import type { EntryRecord } from "./entries";
import { addEntryTagsToTotals, sortedTagTotals } from "./entries";
import type { RowInfo } from "./reports";

const COLORS = {
  gray: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
};

export function formatEntryTagSummary(entry: EntryRecord | undefined): string {
  if (!entry) {
    return "";
  }
  const totals = new Map<string, number>();
  addEntryTagsToTotals(totals, entry);
  return sortedTagTotals(totals)
    .map(([tag, hours]) => `${tag} (${formatHours(hours)})`)
    .join(", ");
}

export function printLoggedOnTagLines(tagTotals: Map<string, number>): void {
  for (const [tag, hours] of sortedTagTotals(tagTotals)) {
    console.log(`Logged on ${tag}: ${formatHours(hours)}`);
  }
}

export function formatHours(hours: number): string {
  if (Number.isInteger(hours)) {
    return String(hours);
  }
  return hours.toFixed(2).replace(/\.?0+$/, "");
}

function colorText(
  value: string,
  color: keyof typeof COLORS,
): string {
  if (!process.stdout.isTTY && !process.stderr.isTTY) {
    return value;
  }
  return `${COLORS[color]}${value}\x1b[0m`;
}

export function warningText(value: string): string {
  return colorText(value, "yellow");
}

export function errorText(value: string): string {
  return colorText(value, "red");
}

function getRowColor(row: RowInfo): "green" | "yellow" | undefined {
  if (!row.isWorkday) {
    return "green";
  }
  if (row.hasBlockingHoliday) {
    return "yellow";
  }
  return undefined;
}

function getHolidayNameColor(row: RowInfo): "gray" | "yellow" | undefined {
  if (!row.isHoliday) {
    return undefined;
  }
  if (row.isOptionalHoliday) {
    return "gray";
  }
  if (row.hasBlockingHoliday) {
    return "yellow";
  }
  return undefined;
}

function renderDayLabel(
  label: string,
  holidayName: string | undefined,
  baseColor: "green" | "yellow" | undefined,
  holidayColor: "gray" | "yellow" | undefined,
): string {
  if (!holidayName || !holidayColor) {
    return baseColor ? colorText(label, baseColor) : label;
  }

  const holidayPart = ` (${holidayName})`;
  const idx = label.indexOf(holidayPart);
  if (idx < 0) {
    return baseColor ? colorText(label, baseColor) : label;
  }

  const before = label.slice(0, idx);
  const after = label.slice(idx + holidayPart.length);
  const renderedBefore = baseColor ? colorText(before, baseColor) : before;
  const renderedHoliday = colorText(holidayPart, holidayColor);
  const renderedAfter = baseColor ? colorText(after, baseColor) : after;
  return `${renderedBefore}${renderedHoliday}${renderedAfter}`;
}

export function printTable(rows: RowInfo[], hoursByRow: string[]): void {
  const dayWidth = Math.max("Day".length, ...rows.map((row) => row.label.length));
  const hoursWidth = Math.max(
    "Hours".length,
    ...hoursByRow.map((value) => value.length),
  );
  const tagsByRow = rows.map((row) => row.tagSummary ?? "");
  const tagsWidth = Math.max("Tags".length, ...tagsByRow.map((value) => value.length));

  console.log(
    `${"Day".padEnd(dayWidth)}  ${"Hours".padEnd(hoursWidth)}  ${"Tags".padEnd(tagsWidth)}`,
  );
  console.log(
    `${"-".repeat(dayWidth)}  ${"-".repeat(hoursWidth)}  ${"-".repeat(tagsWidth)}`,
  );

  rows.forEach((row, i) => {
    const rowColor = getRowColor(row);
    const label = renderDayLabel(
      row.label.padEnd(dayWidth),
      row.holidayName,
      rowColor,
      getHolidayNameColor(row),
    );
    const value = hoursByRow[i].padEnd(hoursWidth);
    const valueColor =
      rowColor ?? (row.loggedHours === undefined ? "gray" : undefined);
    const renderedValue = valueColor ? colorText(value, valueColor) : value;
    console.log(`${label}  ${renderedValue}  ${tagsByRow[i].padEnd(tagsWidth)}`);
  });
}
