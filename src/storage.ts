import * as fs from "node:fs";
import * as path from "node:path";
import { DATA_DIR, ensureBaseDirs } from "./paths";
import { formatIsoDate, MONTH_ABBR } from "./dates";
import type { EntryRecord, AllEntryRecord } from "./entries";
import {
  cloneEntry,
  cloneEntryItem,
  sameTags,
  itemMatchesTagFilter,
  parseStoredTags,
  filterEntryByTags,
} from "./entries";
import { formatHours } from "./output";

export function readEntriesInRange(
  start: Date,
  end: Date,
): Map<string, EntryRecord> {
  const out = new Map<string, EntryRecord>();
  if (!fs.existsSync(DATA_DIR)) {
    return out;
  }

  const startIso = formatIsoDate(start);
  const endIso = formatIsoDate(end);
  const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  for (
    let cursor = startMonth;
    cursor <= endMonth;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    const filePath = monthFilePath(cursor);
    const entries = readMonthEntries(filePath);
    for (const [dateIso, entry] of entries.entries()) {
      if (dateIso >= startIso && dateIso <= endIso) {
        out.set(dateIso, cloneEntry(entry));
      }
    }
  }

  return out;
}

export function writeEntry(
  date: Date,
  hours: number,
  tags: string[] | undefined,
): { oldValue: EntryRecord | undefined; newValue: EntryRecord } {
  ensureBaseDirs();
  const filePath = monthFilePath(date);
  const entries = readMonthEntries(filePath);
  const dateIso = formatIsoDate(date);
  const oldValue = entries.get(dateIso);
  const nextItem = { hours, tags: tags ? [...tags] : [] };

  if (!tags || tags.length === 0) {
    entries.set(dateIso, { items: [nextItem] });
  } else {
    const items = oldValue ? oldValue.items.map(cloneEntryItem) : [];
    const existingIndex = items.findIndex((item) =>
      sameTags(item.tags, tags),
    );
    if (existingIndex >= 0) {
      items[existingIndex] = nextItem;
    } else {
      items.push(nextItem);
    }
    entries.set(dateIso, { items });
  }

  writeMonthEntries(filePath, entries);
  const newValue = entries.get(dateIso);
  if (!newValue) {
    throw new Error(`Failed to write entry for ${dateIso}.`);
  }
  return {
    oldValue: oldValue ? cloneEntry(oldValue) : undefined,
    newValue: cloneEntry(newValue),
  };
}

export function clearEntry(
  date: Date,
  tags: string[] | undefined,
): EntryRecord | undefined {
  ensureBaseDirs();
  const filePath = monthFilePath(date);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const entries = readMonthEntries(filePath);
  const dateIso = formatIsoDate(date);
  const oldValue = entries.get(dateIso);
  if (oldValue === undefined) {
    return undefined;
  }
  if (!tags || tags.length === 0) {
    entries.delete(dateIso);
    writeMonthEntries(filePath, entries);
    return cloneEntry(oldValue);
  }

  const removed = oldValue.items.filter((item) =>
    itemMatchesTagFilter(item, tags),
  );
  if (removed.length === 0) {
    return undefined;
  }

  const remaining = oldValue.items.filter(
    (item) => !itemMatchesTagFilter(item, tags),
  );
  if (remaining.length === 0) {
    entries.delete(dateIso);
  } else {
    entries.set(dateIso, { items: remaining.map(cloneEntryItem) });
  }
  writeMonthEntries(filePath, entries);
  return { items: removed.map(cloneEntryItem) };
}

export function readAllEntries(tagFilters?: string[]): AllEntryRecord[] {
  const out = new Map<string, EntryRecord>();
  if (!fs.existsSync(DATA_DIR)) {
    return [];
  }

  const files = fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .sort();

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const entries = readMonthEntries(filePath);
    for (const [iso, entry] of entries.entries()) {
      out.set(iso, cloneEntry(entry));
    }
  }

  return Array.from(out.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([iso, entry]) => {
      const filtered = filterEntryByTags(entry, tagFilters);
      return filtered ? [{ iso, items: filtered.items }] : [];
    });
}

function monthFilePath(date: Date): string {
  const year = date.getFullYear();
  const month = MONTH_ABBR[date.getMonth()];
  return path.join(DATA_DIR, `${year}_${month}.csv`);
}

function readMonthEntries(filePath: string): Map<string, EntryRecord> {
  const entries = new Map<string, EntryRecord>();
  if (!fs.existsSync(filePath)) {
    return entries;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const normalizedLine = trimmed.toLowerCase();
    if (
      !trimmed ||
      normalizedLine === "date,hours" ||
      normalizedLine === "date,hours,tags"
    ) {
      continue;
    }

    const cells = trimmed.split(",");
    const dateIso = cells[0]?.trim();
    const hoursRaw = cells[1]?.trim();
    const tagsRaw = cells.slice(2).join(",").trim();
    if (!dateIso || !hoursRaw) {
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      continue;
    }

    const hours = Number(hoursRaw);
    if (!Number.isFinite(hours)) {
      continue;
    }

    const item = {
      hours,
      tags: parseStoredTags(tagsRaw),
    };
    const entry = entries.get(dateIso);
    if (entry) {
      entry.items.push(item);
    } else {
      entries.set(dateIso, { items: [item] });
    }
  }

  return entries;
}

function writeMonthEntries(
  filePath: string,
  entries: Map<string, EntryRecord>,
): void {
  const rows = Array.from(entries.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const lines = ["date,hours,tags"];
  for (const [date, entry] of rows) {
    for (const item of entry.items) {
      lines.push(`${date},${formatHours(item.hours)},${item.tags.join("|")}`);
    }
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}
