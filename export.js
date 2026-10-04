// The Excel export: everything logged over the last N days, laid out for tracing where
// gluten may have come from after a reaction.
//
//   Food log   one row per food eaten, newest first, with that day's pain, period and exercise
//   Days       one row per day in the period, including days with nothing logged
//   Sources    one row per place the food came from

import * as db from "./db.js";
import { buildWorkbook, XLSX_MIME } from "./xlsx.js";

const MEAL_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
const NO_SOURCE = "(not given)";

const weekday = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long" });
};

// The period covered by an export of `days` days: today and the days before it.
export function exportPeriod(days) {
  const to = db.dateStr();
  return { from: db.shiftDate(to, -(days - 1)), to };
}

export async function buildLogExport(days) {
  const { from, to } = exportPeriod(days);
  const [entries, dayRecords, periodSetting] = await Promise.all([
    db.entriesBetween(from, to), db.daysBetween(from, to), db.getSetting("period", { enabled: true }),
  ]);
  const newestFirst = [...entries].sort((a, b) =>
    b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.createdAt - a.createdAt);

  // How each day went, repeated on every row of that day. The Period column is left out
  // when period tracking is switched off in Settings.
  const dayOf = new Map(dayRecords.map((d) => [d.date, d]));
  const dayColumns = [
    ...(periodSetting.enabled ? [{ header: "Period", width: 8 }] : []),
    { header: "Pain", type: "number", width: 7 },
    { header: "Pain note", width: 30 },
    { header: "Exercise", width: 9 },
    { header: "Intensity", type: "number", width: 10 },
    { header: "Exercise note", width: 30 },
  ];
  const dayCells = (date) => {
    const d = dayOf.get(date);
    if (!d) return dayColumns.map(() => "");
    return [
      ...(periodSetting.enabled ? [d.period ? "Yes" : ""] : []),
      d.pain, d.painNote,
      d.exercise ? "Yes" : "", d.exercise ? d.intensity : null, d.exercise ? d.exerciseNote : "",
    ];
  };

  const log = {
    name: "Food log",
    columns: [
      { header: "Date", type: "date", width: 12 },
      { header: "Day", width: 11 },
      { header: "Time", type: "time", width: 8 },
      { header: "Meal", width: 11 },
      { header: "Food", width: 30 },
      { header: "Brand", width: 18 },
      { header: "Quantity", type: "number", width: 10 },
      { header: "Unit", width: 7 },
      { header: "Source", width: 24 },
      { header: "Note", width: 36 },
      { header: "Barcode", width: 16 },
      ...dayColumns,
    ],
    rows: newestFirst.map((e) => [
      e.date, weekday(e.date), e.time, MEAL_LABEL[e.meal], e.foodName, e.brand,
      e.amount, e.amount ? (e.unit === "pcs" ? "pieces" : "grams") : "", e.source, e.note, e.barcode,
      ...dayCells(e.date),
    ]),
  };

  const dayRows = [];
  for (let date = to; date >= from; date = db.shiftDate(date, -1)) {
    const list = entries.filter((e) => e.date === date);
    const meals = ["breakfast", "lunch", "dinner", "snack"].filter((m) => list.some((e) => e.meal === m));
    const sources = [...new Set(list.map((e) => e.source).filter(Boolean))];
    dayRows.push([date, weekday(date), list.length, meals.map((m) => MEAL_LABEL[m]).join(", "), sources.join(", "),
      ...dayCells(date)]);
  }
  const daysSheet = {
    name: "Days",
    columns: [
      { header: "Date", type: "date", width: 12 },
      { header: "Day", width: 11 },
      { header: "Foods logged", type: "number", width: 13 },
      { header: "Meals logged", width: 34 },
      { header: "Sources", width: 44 },
      ...dayColumns,
    ],
    rows: dayRows,
  };

  const bySource = new Map();
  for (const e of entries) {
    const key = (e.source || NO_SOURCE).toLowerCase();
    const row = bySource.get(key) ?? { name: e.source || NO_SOURCE, count: 0, dates: new Set() };
    row.count++;
    row.dates.add(e.date);
    bySource.set(key, row);
  }
  const sourcesSheet = {
    name: "Sources",
    columns: [
      { header: "Source", width: 28 },
      { header: "Foods logged", type: "number", width: 13 },
      { header: "Days", type: "number", width: 8 },
      { header: "First", type: "date", width: 12 },
      { header: "Last", type: "date", width: 12 },
    ],
    rows: [...bySource.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((s) => {
        const dates = [...s.dates].sort();
        return [s.name, s.count, dates.length, dates[0], dates[dates.length - 1]];
      }),
  };

  const bytes = buildWorkbook([log, daysSheet, sourcesSheet]);
  return {
    file: new File([bytes], `food-log_${from}_to_${to}.xlsx`, { type: XLSX_MIME }),
    count: entries.length, dayCount: dayRecords.length, from, to,
  };
}
