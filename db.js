// The food log. Everything is stored on the phone in IndexedDB; nothing is sent anywhere.
//
//   entries   one row per logged food: id, date, time, meal, foodName, amount, unit, source, note,
//             brand, barcode, foodId
//   foods     saved foods: id, name, brand, barcode, portionAmount, portionUnit, favourite, lastUsed, useCount
//   meals     saved meals: id, name, items [{ foodId, foodName, amount, unit }]
//   settings  key/value pairs

export const MEALS = ["breakfast", "lunch", "dinner", "snack"];
export const UNITS = ["g", "pcs"];

const DB_VERSION = 1;
const BACKUP_FORMAT = 1;
let dbName = "foodlog";
let dbPromise = null;

// Tests point this at a throwaway database.
export function useDatabase(name) {
  dbName = name;
  dbPromise = null;
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("entries", { keyPath: "id" }).createIndex("date", "date");
        db.createObjectStore("foods", { keyPath: "id" }).createIndex("barcode", "barcode");
        db.createObjectStore("meals", { keyPath: "id" });
        db.createObjectStore("settings", { keyPath: "key" });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Let go when the database is being deleted or upgraded from elsewhere,
        // rather than holding that up; the next call reopens it.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Runs fn inside one transaction and resolves with its result once the transaction commits.
async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
    Promise.resolve(fn(tx)).then(
      (value) => { result = value; },
      (err) => { try { tx.abort(); } catch { /* already finished */ } reject(err); });
  });
}

const read = (store, fn) => run(store, "readonly", (tx) => fn(tx.objectStore(store)));
const write = (store, fn) => run(store, "readwrite", (tx) => fn(tx.objectStore(store)));

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const pad = (n) => String(n).padStart(2, "0");

// Local calendar date, not UTC: a meal logged at 00:30 belongs to that day.
export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeStr(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shiftDate(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  return dateStr(new Date(y, m - 1, d + days));
}

// "150", "150,5" and "150.5" are all accepted; empty means no amount. Returns NaN if unreadable.
export function parseAmount(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function cleanAmount(amount) {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null;
}

const cleanUnit = (unit) => (UNITS.includes(unit) ? unit : "g");

// ---------------------------------------------------------------- row builders

// Every stored row is rebuilt field by field by these, whether it comes from the app's own
// forms or from a backup file. Nothing that is not listed here is ever stored, ids, dates
// and times must have exactly the expected shape, and text is cut to a sane length.
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const wholeNumber = (value) => (Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

function validId(id, what) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(`${what} has an invalid id`);
  return id;
}

const optionalId = (id, what) => (id === null || id === undefined ? null : validId(id, what));

function buildEntry(entry) {
  const foodName = text(entry.foodName, 200);
  if (!foodName) throw new Error("An entry needs a food name");
  if (!MEALS.includes(entry.meal)) throw new Error(`Unknown meal: ${text(entry.meal, 40)}`);
  const date = entry.date ?? dateStr();
  const time = entry.time ?? timeStr();
  if (typeof date !== "string" || !DATE_RE.test(date)) throw new Error("An entry needs a date like 2026-10-04");
  if (typeof time !== "string" || !TIME_RE.test(time)) throw new Error("An entry needs a time like 12:30");
  return {
    id: validId(entry.id ?? newId(), "An entry"),
    createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
    date,
    time,
    meal: entry.meal,
    foodName,
    amount: cleanAmount(entry.amount),
    unit: cleanUnit(entry.unit),
    source: text(entry.source, 200),      // where the food came from: home, a restaurant…
    note: text(entry.note, 2000),
    brand: text(entry.brand, 200),
    barcode: text(entry.barcode, 64),
    foodId: optionalId(entry.foodId, "An entry's food"),
  };
}

function buildFood(food) {
  const name = text(food.name, 200);
  if (!name) throw new Error("A food needs a name");
  return {
    id: validId(food.id ?? newId(), "A food"),
    name,
    brand: text(food.brand, 200),
    barcode: text(food.barcode, 64),
    portionAmount: cleanAmount(food.portionAmount),
    portionUnit: cleanUnit(food.portionUnit),
    favourite: Boolean(food.favourite),
    lastUsed: wholeNumber(food.lastUsed),
    useCount: wholeNumber(food.useCount),
  };
}

function buildMeal(meal) {
  const name = text(meal.name, 200);
  if (!name) throw new Error("A meal needs a name");
  if (meal.items !== undefined && !Array.isArray(meal.items)) throw new Error("A meal's foods must be a list");
  const items = (meal.items ?? [])
    .filter((it) => text(it?.foodName, 200))
    .map((it) => ({
      foodId: optionalId(it.foodId, "A meal's food"),
      foodName: text(it.foodName, 200),
      amount: cleanAmount(it.amount),
      unit: cleanUnit(it.unit),
    }));
  if (!items.length) throw new Error("A meal needs at least one food");
  return { id: validId(meal.id ?? newId(), "A meal"), name, items };
}

// Only the settings the app knows are kept from a backup; anything else is left out.
function buildSetting(row) {
  const { key, value } = row ?? {};
  if (key === "reminders") {
    const times = {};
    for (const meal of ["breakfast", "lunch", "dinner"]) {
      const time = value?.times?.[meal];
      if (typeof time !== "string" || !TIME_RE.test(time)) throw new Error("The reminder times are invalid");
      times[meal] = time;
    }
    return { key, value: { enabled: Boolean(value.enabled), times } };
  }
  if (key === "dismissed") {
    if (typeof value?.date !== "string" || !DATE_RE.test(value.date) || !Array.isArray(value.meals)) {
      throw new Error("The dismissed reminders are invalid");
    }
    return { key, value: { date: value.date, meals: value.meals.filter((m) => MEALS.includes(m)) } };
  }
  if (key === "lastExport" && Number.isFinite(value)) return { key, value };
  return null;
}

// ---------------------------------------------------------------- entries

export async function saveEntry(entry) {
  const row = buildEntry(entry);
  await write("entries", (s) => done(s.put(row)));
  return row;
}

export const getEntry = (id) => read("entries", (s) => done(s.get(id)));
export const deleteEntry = (id) => write("entries", (s) => done(s.delete(id)));

const byTime = (a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt;

export async function entriesForDate(date) {
  const rows = await read("entries", (s) => done(s.index("date").getAll(date)));
  return rows.sort(byTime);
}

// Both ends inclusive.
export async function entriesBetween(from, to) {
  const rows = await read("entries", (s) => done(s.index("date").getAll(IDBKeyRange.bound(from, to))));
  return rows.sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b));
}

export const allEntries = () => read("entries", (s) => done(s.getAll()));

// The places food has come from, most recently used first, for suggestions.
export async function recentSources(limit = 6) {
  const rows = (await allEntries()).filter((e) => e.source);
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.createdAt - a.createdAt);
  const seen = new Map();
  for (const e of rows) {
    const key = e.source.toLowerCase();
    if (!seen.has(key)) seen.set(key, e.source);
    if (seen.size === limit) break;
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- foods

export async function saveFood(food) {
  const row = buildFood(food);
  await write("foods", (s) => done(s.put(row)));
  return row;
}

export const getFood = (id) => read("foods", (s) => done(s.get(id)));
export const deleteFood = (id) => write("foods", (s) => done(s.delete(id)));

export async function allFoods() {
  const rows = await read("foods", (s) => done(s.getAll()));
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function foodByBarcode(barcode) {
  const code = String(barcode ?? "").trim();
  if (!code) return null;
  return (await read("foods", (s) => done(s.index("barcode").get(code)))) ?? null;
}

export async function foodByName(name) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return (await allFoods()).find((f) => f.name.toLowerCase() === wanted) ?? null;
}

// Called whenever a food is logged, so it shows up under Recent next time. Matches an
// existing food by barcode, then by name; otherwise creates one whose portion is the
// amount just logged.
export async function rememberFood({ name, brand = "", barcode = "", amount = null, unit = "g" }) {
  const existing = (await foodByBarcode(barcode)) ?? (await foodByName(name));
  const food = existing ?? {
    name, brand, barcode, portionAmount: amount, portionUnit: unit, favourite: false, useCount: 0,
  };
  if (existing) {
    if (barcode && !existing.barcode) food.barcode = barcode;
    if (brand && !existing.brand) food.brand = brand;
    if (!existing.portionAmount && amount) {
      food.portionAmount = amount;
      food.portionUnit = unit;
    }
  }
  food.lastUsed = Date.now();
  food.useCount = (food.useCount ?? 0) + 1;
  return saveFood(food);
}

// ---------------------------------------------------------------- meals

export async function saveMeal(meal) {
  const row = buildMeal(meal);
  await write("meals", (s) => done(s.put(row)));
  return row;
}

export const getMeal = (id) => read("meals", (s) => done(s.get(id)));
export const deleteMeal = (id) => write("meals", (s) => done(s.delete(id)));

export async function allMeals() {
  const rows = await read("meals", (s) => done(s.getAll()));
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// ---------------------------------------------------------------- settings

export async function getSetting(key, fallback = null) {
  const row = await read("settings", (s) => done(s.get(key)));
  return row ? row.value : fallback;
}

export const setSetting = (key, value) => write("settings", (s) => done(s.put({ key, value })));

// ---------------------------------------------------------------- backup

const STORES = ["entries", "foods", "meals", "settings"];

export async function exportData() {
  const data = await run(STORES, "readonly", async (tx) => {
    const out = {};
    for (const name of STORES) out[name] = await done(tx.objectStore(name).getAll());
    return out;
  });
  return { app: "foodlog", format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), ...data };
}

// Replaces everything on the phone with the contents of a backup. The file is treated as
// untrusted: every row is checked and rebuilt first, and if anything in it is not what the
// app itself would have written, nothing is restored.
export async function importData(data) {
  if (!data || data.app !== "foodlog" || !STORES.every((name) => Array.isArray(data[name]))) {
    throw new Error("This file is not a Food Log backup");
  }
  if (data.format > BACKUP_FORMAT) {
    throw new Error("This backup was made by a newer version of the app");
  }
  const rebuild = (rows, build, what) => rows.map((row) => {
    if (!row || typeof row !== "object") throw new Error(`${what} is not a record`);
    validId(row.id, what);          // a backup row must carry its own id; none is made up for it
    return build(row);
  });
  let clean;
  try {
    clean = {
      entries: rebuild(data.entries, buildEntry, "An entry"),
      foods: rebuild(data.foods, buildFood, "A food"),
      meals: rebuild(data.meals, buildMeal, "A meal"),
      settings: data.settings.map(buildSetting).filter(Boolean),
    };
  } catch (err) {
    throw new Error(`This backup file is damaged and was not restored: ${err.message}`);
  }
  await run(STORES, "readwrite", (tx) => {
    for (const name of STORES) {
      const store = tx.objectStore(name);
      store.clear();
      for (const row of clean[name]) store.put(row);
    }
  });
  return { entries: clean.entries.length, foods: clean.foods.length, meals: clean.meals.length };
}

// Asks the browser not to evict the log when the phone runs low on space.
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
