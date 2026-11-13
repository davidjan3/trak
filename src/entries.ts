interface EntryItem {
  hours: number;
  tags: string[];
}

export interface EntryRecord {
  items: EntryItem[];
}

export interface AllEntryRecord extends EntryRecord {
  iso: string;
}

export function parseTags(raw: string): string[] | null {
  const tags = normalizeTags(raw.split(","));
  return tags.some((tag) => !tag || tag.includes("|")) ? null : tags;
}

export function filterEntryByTags(
  entry: EntryRecord,
  tagFilters: string[] | undefined,
): EntryRecord | undefined {
  const items =
    !tagFilters || tagFilters.length === 0
      ? entry.items
      : entry.items.filter((item) => itemMatchesTagFilter(item, tagFilters));
  if (items.length === 0) {
    return undefined;
  }
  return { items: items.map(cloneEntryItem) };
}

export function itemMatchesTagFilter(
  item: EntryItem,
  tagFilters: string[] | undefined,
): boolean {
  if (!tagFilters || tagFilters.length === 0) {
    return true;
  }
  return tagFilters.some((tag) => item.tags.includes(tag));
}

export function addEntryTagsToTotals(
  totals: Map<string, number>,
  entry: EntryRecord,
): void {
  for (const item of entry.items) {
    for (const tag of item.tags) {
      totals.set(tag, (totals.get(tag) ?? 0) + item.hours);
    }
  }
}

export function sortedTagTotals(
  tagTotals: Map<string, number>,
): Array<[string, number]> {
  return Array.from(tagTotals.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
}

export function parseStoredTags(raw: string): string[] {
  return normalizeTags(raw.split("|")).filter(Boolean);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()))];
}

export function cloneEntry(entry: EntryRecord): EntryRecord {
  return {
    items: entry.items.map(cloneEntryItem),
  };
}

export function cloneEntryItem(item: EntryItem): EntryItem {
  return {
    hours: item.hours,
    tags: [...item.tags],
  };
}

export function entryTotal(entry: EntryRecord): number {
  return entry.items.reduce((total, item) => total + item.hours, 0);
}

export function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const aTags = new Set(a);
  return b.every((tag) => aTags.has(tag));
}
