import Holidays, { type HolidaysTypes } from "date-holidays";
import type { Settings } from "./settings";

export function validateLocale(localeRaw: string): void {
  const locale = parseLocale(localeRaw);
  try {
    const hd = new Holidays(locale);
    if (!hd || typeof hd.isHoliday !== "function") {
      throw new Error("Holiday engine unavailable for locale.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid locale "${localeRaw}": ${message}`);
  }
}

export function describeLocale(localeRaw: string): string {
  const locale = parseLocale(localeRaw);
  const { country, state, region } = locale;
  const fallback = localeRaw.toLowerCase();

  try {
    const hd = new Holidays(locale);
    const language = country === "DE" ? "de" : "en";
    const countryName =
      hd.getCountries(language)?.[country] ??
      hd.getCountries("en")?.[country] ??
      country;
    const segments = [countryName];

    if (state) {
      const stateName =
        hd.getStates(country, language)?.[state] ??
        hd.getStates(country, "en")?.[state] ??
        state;
      segments.push(stateName);
    }

    if (state && region) {
      const regionName =
        hd.getRegions(country, state, language)?.[region] ??
        hd.getRegions(country, state, "en")?.[region] ??
        region;
      segments.push(regionName);
    }

    return `${segments.join(" / ")} (${fallback})`;
  } catch {
    return fallback;
  }
}

function parseLocale(localeRaw: string): HolidaysTypes.Country {
  const parts = localeRaw
    .split("-")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase());

  if (parts.length < 1 || parts.length > 3) {
    throw new Error(
      `Locale "${localeRaw}" must be "country", "country-region", or "country-region-subregion".`,
    );
  }

  return { country: parts[0], state: parts[1], region: parts[2] };
}

export function isWorkday(dayOfWeek: number, settings: Settings): boolean {
  if (settings.workweekStart <= settings.workweekEnd) {
    return (
      dayOfWeek >= settings.workweekStart && dayOfWeek <= settings.workweekEnd
    );
  }
  return (
    dayOfWeek >= settings.workweekStart || dayOfWeek <= settings.workweekEnd
  );
}

export function createHolidayEngine(settings: Settings): Holidays {
  return new Holidays(parseLocale(settings.localeRaw));
}

export function getHolidayInfo(
  engine: Holidays,
  date: Date,
): {
  isHoliday: boolean;
  name?: string;
  type?: string;
  isOptionalHoliday: boolean;
  hasBlockingHoliday: boolean;
} {
  const value = engine.isHoliday(date);
  const list: Array<HolidaysTypes.Holiday & { localName?: string }> =
    !value ? [] : Array.isArray(value) ? value : [value];
  if (list.length === 0) {
    return {
      isHoliday: false,
      isOptionalHoliday: false,
      hasBlockingHoliday: false,
    };
  }

  const normalized = list
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const type = normalizeHolidayType(item.type);
      const optional = isOptionalHolidayType(type);
      return {
        name: item.name ?? item.localName ?? "Holiday",
        type,
        optional,
      };
    });

  if (normalized.length === 0) {
    return {
      isHoliday: true,
      name: "Holiday",
      type: "holiday",
      isOptionalHoliday: false,
      hasBlockingHoliday: true,
    };
  }

  const blocking = normalized.find((item) => !item.optional);
  const primary = blocking ?? normalized[0];
  const optionalOnly = normalized.every((item) => item.optional);

  return {
    isHoliday: true,
    name: primary.name,
    type: primary.type,
    isOptionalHoliday: optionalOnly,
    hasBlockingHoliday: !optionalOnly,
  };
}

function normalizeHolidayType(rawType: unknown): string {
  if (typeof rawType !== "string" || rawType.trim().length === 0) {
    return "holiday";
  }
  return rawType.trim().toLowerCase();
}

function isOptionalHolidayType(type: string): boolean {
  return type === "optional" || type === "observance";
}
