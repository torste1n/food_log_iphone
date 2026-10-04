// Food Log: screens and navigation. Storage lives in db.js, charts in charts.js and the
// Excel export in export.js.

import * as db from "./db.js";
import { MEALS, UNITS } from "./db.js";
import { columnChart, rankedBars } from "./charts.js";
import { buildLogExport, exportPeriod } from "./export.js";

const APP_VERSION = "1.0";
const TABS = ["today", "history", "add", "saved", "settings"];
const MEAL_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
const MEAL_COLOR = { breakfast: "--series-1", lunch: "--series-2", dinner: "--series-3", snack: "--series-4" };
const REMINDED_MEALS = ["breakfast", "lunch", "dinner"];
const DEFAULT_REMINDERS = { enabled: true, times: { breakfast: "08:00", lunch: "12:00", dinner: "18:00" } };
const DEFAULT_PERIOD = { enabled: true };
const RANGES = {
  7: { label: "7 days", days: 7, weekly: false },
  30: { label: "30 days", days: 30, weekly: false },
  84: { label: "12 weeks", days: 84, weekly: true },
};
const LOCALE = "en-GB";
const EXPORT_DAY_CHOICES = [1, 2, 3, 7, 14, 30];
const DEFAULT_EXPORT_DAYS = 3;
const MAX_EXPORT_DAYS = 3650;

const view = document.getElementById("view");
const overlay = document.getElementById("overlay");
const toastEl = document.getElementById("toast");

const state = {
  reminders: DEFAULT_REMINDERS,
  period: DEFAULT_PERIOD,   // whether the Period checkbox is shown on the Today screen
  addContext: null,       // { meal, date } when Add was opened from a meal's + button
  savedSegment: "foods",
  range: 30,
  lastTab: null,
};

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtNum = (n) => String(Math.round(n * 100) / 100);

function fmtAmount(amount, unit) {
  if (!amount) return "";
  return unit === "pcs" ? `${fmtNum(amount)} ${amount === 1 ? "pc" : "pcs"}` : `${fmtNum(amount)} g`;
}

const toDate = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const fmtDay = (date, options) => toDate(date).toLocaleDateString(LOCALE, options);

function dayTitle(date) {
  const today = db.dateStr();
  if (date === today) return "Today";
  if (date === db.shiftDate(today, -1)) return "Yesterday";
  return fmtDay(date, { weekday: "long" });
}

// The main meal whose usual time is nearest, if within two hours; otherwise a snack.
function guessMeal(time = db.timeStr()) {
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let best = "snack", bestGap = 121;
  for (const meal of REMINDED_MEALS) {
    const usual = state.reminders.times[meal];
    if (!usual) continue;
    const gap = Math.abs(minutes(time) - minutes(usual));
    if (gap < bestGap) [best, bestGap] = [meal, gap];
  }
  return best;
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function segmented(name, options, value, extraClass = "") {
  return `<div class="seg ${extraClass}" role="radiogroup">${options.map(([v, label]) =>
    `<label><input type="radio" name="${name}" value="${esc(v)}" ${v === value ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div>`;
}

// A time of day is chosen as hour and minute, 00:00 to 23:59. The phone's own time picker
// is not used, because it shows AM and PM whenever the phone is set to a 12-hour clock.
const two = (n) => String(n).padStart(2, "0");

function timeField(name, value, disabled = false) {
  const [hour, minute] = String(value).split(":");
  const options = (count, chosen) => Array.from({ length: count }, (_, i) =>
    `<option${two(i) === chosen ? " selected" : ""}>${two(i)}</option>`).join("");
  const attrs = disabled ? "disabled" : "";
  return `<span class="time-field" data-time="${name}">`
    + `<select aria-label="Hour" ${attrs}>${options(24, hour)}</select><span aria-hidden="true">:</span>`
    + `<select aria-label="Minute" ${attrs}>${options(60, minute)}</select></span>`;
}

const readTime = (root, name) =>
  [...root.querySelectorAll(`[data-time="${name}"] select`)].map((s) => s.value).join(":");

const unitOptions = UNITS.map((u) => [u, u === "g" ? "grams" : "pieces"]);
const mealOptions = MEALS.map((m) => [m, MEAL_LABEL[m]]);

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/></svg>',
};

// ---------------------------------------------------------------- sheets

function openSheet(html) {
  closeSheet();
  toastEl.classList.remove("show");     // a lingering message would sit on top of the sheet's buttons
  overlay.innerHTML = `<div class="backdrop" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.classList.add("sheet-open");
  return overlay.querySelector(".sheet");
}

function closeSheet() {
  overlay.innerHTML = "";
  document.body.classList.remove("sheet-open");
}

const sheetOpen = () => overlay.childElementCount > 0;

// An error message goes away as soon as the user changes something.
overlay.addEventListener("input", () => {
  const error = overlay.querySelector(".form-error");
  if (error) error.hidden = true;
});

// Sets a field as if the user had typed it, so everything listening to the form reacts.
function setField(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const sheetHead = (title, submitLabel = "Save") => `
  <div class="sheet-head">
    <button type="button" class="link" data-action="close-sheet">Cancel</button>
    <h2>${esc(title)}</h2>
    <button type="submit" class="link strong">${esc(submitLabel)}</button>
  </div>`;

function showError(form, message) {
  const el = form.querySelector(".form-error");
  el.textContent = message;
  el.hidden = false;
}

// Resolves true when the user confirms.
function confirmSheet({ title, body, confirmLabel, cancelLabel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const sheet = openSheet(`
      <div class="confirm">
        <h2>${esc(title)}</h2>
        <p>${esc(body)}</p>
        <button type="button" class="btn ${danger ? "danger" : "primary"}" data-confirm="yes">${esc(confirmLabel)}</button>
        <button type="button" class="btn" data-confirm="no">${esc(cancelLabel)}</button>
      </div>`);
    sheet.classList.add("sheet-compact");
    overlay.addEventListener("click", function onClick(e) {
      const answer = e.target.closest("[data-confirm]")?.dataset.confirm;
      const dismissed = e.target.closest(".backdrop");
      if (!answer && !dismissed) return;
      overlay.removeEventListener("click", onClick);
      closeSheet();
      resolve(answer === "yes");
    });
  });
}

// ---------------------------------------------------------------- entry sheet

// "Where from": free text, with the places used most recently one tap away.
function sourceField(value, sources) {
  const suggestions = sources.length ? sources : ["Home"];
  return `
    <div class="field"><span>Where from</span>
      <input name="source" type="text" value="${esc(value)}" autocomplete="off" autocapitalize="sentences" placeholder="Home, a restaurant, the cafeteria…" aria-label="Where the food came from">
      <div class="chips">${suggestions.map((s) =>
        `<button type="button" class="chip" data-source="${esc(s)}">${esc(s)}</button>`).join("")}</div>
    </div>`;
}

function wireSourceChips(form) {
  form.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-source]");
    if (chip) setField(form.elements.source, chip.dataset.source);
  });
}

// One form for logging a new entry and for editing an existing one.
//   entry  existing entry being edited
//   food   saved food the entry is made from (gives the portion size)
//   name   food name typed on the Add screen, for a food that is not saved yet
async function openEntrySheet({ entry = null, food = null, name = "", meal = null, date = null } = {}) {
  const portion = food?.portionAmount ? { amount: food.portionAmount, unit: food.portionUnit } : null;
  const init = {
    foodName: entry?.foodName ?? food?.name ?? name,
    amount: entry ? entry.amount : portion?.amount ?? null,
    unit: entry?.unit ?? portion?.unit ?? "g",
    meal: entry?.meal ?? meal ?? guessMeal(),
    date: entry?.date ?? date ?? db.dateStr(),
    time: entry?.time ?? db.timeStr(),
    note: entry?.note ?? "",
  };
  const [sources, sameDay] = await Promise.all([db.recentSources(), db.entriesForDate(init.date)]);
  // Foods added to a meal usually come from the same place as the ones already in it.
  init.source = entry ? entry.source ?? ""
    : sameDay.filter((e) => e.meal === init.meal && e.source).pop()?.source ?? "";

  const sheet = openSheet(`
    <form class="sheet-form" novalidate>
      ${sheetHead(entry ? "Edit entry" : "Log food")}
      <label class="field"><span>Food</span>
        <input name="foodName" type="text" value="${esc(init.foodName)}" autocomplete="off" autocapitalize="sentences" placeholder="What did you eat?">
      </label>
      <div class="field"><span>Amount</span>
        <div class="amount-row">
          <input name="amount" type="text" inputmode="decimal" value="${init.amount ? fmtNum(init.amount) : ""}" placeholder="Optional" aria-label="Amount">
          ${segmented("unit", unitOptions, init.unit)}
        </div>
        ${portion ? `
        <div class="portion-row">
          <button type="button" class="step" data-step="-1" aria-label="One portion less">−</button>
          <span class="portion-label"></span>
          <button type="button" class="step" data-step="1" aria-label="One portion more">+</button>
        </div>` : ""}
      </div>
      <div class="field"><span>Meal</span>${segmented("meal", mealOptions, init.meal, "seg-4")}</div>
      ${sourceField(init.source, sources)}
      <div class="field-pair">
        <label class="field"><span>Date</span><input name="date" type="date" value="${esc(init.date)}" max="${db.dateStr()}"></label>
        <div class="field"><span>Time</span>${timeField("time", init.time)}</div>
      </div>
      <label class="field"><span>Note</span>
        <textarea name="note" rows="2" placeholder="Optional">${esc(init.note)}</textarea>
      </label>
      <p class="form-error" hidden></p>
      ${entry ? `<button type="button" class="btn danger" data-action="delete-entry" data-id="${esc(entry.id)}">Delete entry</button>` : ""}
    </form>`);

  const form = sheet.querySelector("form");
  const fields = form.elements;
  wireSourceChips(form);

  if (portion) {
    const label = form.querySelector(".portion-label");
    const row = form.querySelector(".portion-row");
    const refresh = () => {
      const amount = db.parseAmount(fields.amount.value);
      row.hidden = fields.unit.value !== portion.unit;
      const n = amount && !Number.isNaN(amount) ? amount / portion.amount : 0;
      label.textContent = `${fmtNum(n)} ${n === 1 ? "portion" : "portions"} · 1 portion = ${fmtAmount(portion.amount, portion.unit)}`;
    };
    form.addEventListener("input", refresh);
    form.addEventListener("click", (e) => {
      const step = Number(e.target.closest(".step")?.dataset.step);
      if (!step) return;
      const current = db.parseAmount(fields.amount.value);
      const next = (current && !Number.isNaN(current) ? current : 0) + step * portion.amount;
      fields.amount.value = fmtNum(Math.max(portion.amount, next));
      refresh();
    });
    refresh();
  }
  if (!init.foodName) fields.foodName.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const foodName = fields.foodName.value.trim();
    const amount = db.parseAmount(fields.amount.value);
    if (!foodName) return showError(form, "Type what you ate.");
    if (Number.isNaN(amount)) return showError(form, "The amount must be a number above zero, or left empty.");
    if (!fields.date.value) return showError(form, "Choose a date.");

    const values = {
      foodName, amount, unit: fields.unit.value, meal: fields.meal.value, source: fields.source.value,
      date: fields.date.value, time: readTime(form, "time"), note: fields.note.value,
    };
    if (entry) {
      await db.saveEntry({ ...entry, ...values });
    } else {
      const remembered = await db.rememberFood({ name: foodName, amount, unit: values.unit });
      await db.saveEntry({ ...values, foodId: remembered.id, brand: remembered.brand, barcode: remembered.barcode });
    }
    closeSheet();
    state.addContext = null;
    toast(entry ? "Entry updated" : `Logged to ${MEAL_LABEL[values.meal].toLowerCase()}`);
    goToDay(values.date);
  });
}

function goToDay(date) {
  const target = date === db.dateStr() ? "#today" : `#today/${date}`;
  if (location.hash === target) render();
  else location.hash = target;
}

// ---------------------------------------------------------------- meal sheets

async function openLogMealSheet(meal, { slot = null, date = null } = {}) {
  const sources = await db.recentSources();
  const sheet = openSheet(`
    <form class="sheet-form" novalidate>
      ${sheetHead(meal.name, "Log")}
      <ul class="plain-list">${meal.items.map((it) =>
        `<li><span>${esc(it.foodName)}</span><span class="muted">${esc(fmtAmount(it.amount, it.unit))}</span></li>`).join("")}</ul>
      <div class="field"><span>Meal</span>${segmented("meal", mealOptions, slot ?? guessMeal(), "seg-4")}</div>
      ${sourceField("", sources)}
      <div class="field-pair">
        <label class="field"><span>Date</span><input name="date" type="date" value="${esc(date ?? db.dateStr())}" max="${db.dateStr()}"></label>
        <div class="field"><span>Time</span>${timeField("time", db.timeStr())}</div>
      </div>
      <p class="form-error" hidden></p>
    </form>`);
  const form = sheet.querySelector("form");
  wireSourceChips(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { meal: slotField, date: dateField, source } = form.elements;
    if (!dateField.value) return showError(form, "Choose a date.");
    for (const it of meal.items) {
      const food = await db.rememberFood({ name: it.foodName, amount: it.amount, unit: it.unit });
      await db.saveEntry({
        foodName: it.foodName, amount: it.amount, unit: it.unit, foodId: food.id,
        brand: food.brand, barcode: food.barcode, source: source.value,
        meal: slotField.value, date: dateField.value, time: readTime(form, "time"),
      });
    }
    closeSheet();
    state.addContext = null;
    toast(`Logged ${meal.items.length} ${meal.items.length === 1 ? "food" : "foods"}`);
    goToDay(dateField.value);
  });
}

function mealItemRow(item = {}) {
  return `
    <div class="item-row">
      <input name="itemName" type="text" list="food-names" value="${esc(item.foodName ?? "")}" placeholder="Food" autocomplete="off" aria-label="Food">
      <input name="itemAmount" type="text" inputmode="decimal" value="${item.amount ? fmtNum(item.amount) : ""}" placeholder="Amount" aria-label="Amount">
      <select name="itemUnit" aria-label="Unit">${UNITS.map((u) =>
        `<option value="${u}" ${u === (item.unit ?? "g") ? "selected" : ""}>${u}</option>`).join("")}</select>
      <button type="button" class="icon-btn" data-remove-item aria-label="Remove">${ICON.close}</button>
    </div>`;
}

async function openMealSheet(meal = null, prefill = []) {
  const foods = await db.allFoods();
  const items = meal?.items ?? prefill;
  const sheet = openSheet(`
    <form class="sheet-form" novalidate>
      ${sheetHead(meal ? "Edit meal" : "New meal")}
      <label class="field"><span>Name</span>
        <input name="name" type="text" value="${esc(meal?.name ?? "")}" autocomplete="off" autocapitalize="sentences" placeholder="For example Usual breakfast">
      </label>
      <div class="field"><span>Foods</span>
        <div class="items">${(items.length ? items : [{}]).map(mealItemRow).join("")}</div>
        <button type="button" class="btn" data-add-item>${ICON.plus} Add a food</button>
      </div>
      <datalist id="food-names">${foods.map((f) => `<option value="${esc(f.name)}">`).join("")}</datalist>
      <p class="form-error" hidden></p>
      ${meal ? `<button type="button" class="btn danger" data-action="delete-meal" data-id="${esc(meal.id)}">Delete meal</button>` : ""}
    </form>`);
  const form = sheet.querySelector("form");
  const list = form.querySelector(".items");
  if (!meal) form.elements.name.focus();

  form.addEventListener("click", (e) => {
    if (e.target.closest("[data-add-item]")) {
      list.insertAdjacentHTML("beforeend", mealItemRow());
      list.lastElementChild.querySelector("input").focus();
    }
    const remove = e.target.closest("[data-remove-item]");
    if (remove) remove.closest(".item-row").remove();
  });
  // Picking a saved food fills in its portion.
  form.addEventListener("change", (e) => {
    if (e.target.name !== "itemName") return;
    const row = e.target.closest(".item-row");
    const food = foods.find((f) => f.name.toLowerCase() === e.target.value.trim().toLowerCase());
    const amountInput = row.querySelector('[name="itemAmount"]');
    if (food?.portionAmount && !amountInput.value) {
      amountInput.value = fmtNum(food.portionAmount);
      row.querySelector('[name="itemUnit"]').value = food.portionUnit;
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) return showError(form, "Give the meal a name.");
    const rows = [];
    for (const row of list.querySelectorAll(".item-row")) {
      const foodName = row.querySelector('[name="itemName"]').value.trim();
      if (!foodName) continue;
      const amount = db.parseAmount(row.querySelector('[name="itemAmount"]').value);
      if (Number.isNaN(amount)) return showError(form, `The amount for ${foodName} must be a number above zero, or left empty.`);
      const saved = foods.find((f) => f.name.toLowerCase() === foodName.toLowerCase());
      rows.push({ foodId: saved?.id ?? null, foodName, amount, unit: row.querySelector('[name="itemUnit"]').value });
    }
    if (!rows.length) return showError(form, "Add at least one food.");
    await db.saveMeal({ id: meal?.id, name, items: rows });
    closeSheet();
    toast("Meal saved");
    state.savedSegment = "meals";
    if (location.hash === "#saved") render();
  });
}

// ---------------------------------------------------------------- food sheet

function openFoodSheet(food = null) {
  const sheet = openSheet(`
    <form class="sheet-form" novalidate>
      ${sheetHead(food ? "Edit food" : "New food")}
      <label class="field"><span>Name</span>
        <input name="name" type="text" value="${esc(food?.name ?? "")}" autocomplete="off" autocapitalize="sentences">
      </label>
      <label class="field"><span>Brand</span>
        <input name="brand" type="text" value="${esc(food?.brand ?? "")}" autocomplete="off" placeholder="Optional">
      </label>
      <div class="field"><span>One portion</span>
        <div class="amount-row">
          <input name="portionAmount" type="text" inputmode="decimal" value="${food?.portionAmount ? fmtNum(food.portionAmount) : ""}" placeholder="For example 150" aria-label="Portion amount">
          ${segmented("portionUnit", unitOptions, food?.portionUnit ?? "g")}
        </div>
      </div>
      <label class="field"><span>Barcode</span>
        <input name="barcode" type="text" inputmode="numeric" value="${esc(food?.barcode ?? "")}" autocomplete="off" placeholder="Optional">
      </label>
      <label class="switch-row"><span>Favourite</span><input name="favourite" type="checkbox" ${food?.favourite ? "checked" : ""}></label>
      <p class="form-error" hidden></p>
      ${food ? `<button type="button" class="btn danger" data-action="delete-food" data-id="${esc(food.id)}">Delete food</button>` : ""}
    </form>`);
  const form = sheet.querySelector("form");
  if (!food) form.elements.name.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = form.elements;
    const name = f.name.value.trim();
    const portionAmount = db.parseAmount(f.portionAmount.value);
    if (!name) return showError(form, "Give the food a name.");
    if (Number.isNaN(portionAmount)) return showError(form, "The portion must be a number above zero, or left empty.");
    const clash = await db.foodByName(name);
    if (clash && clash.id !== food?.id) return showError(form, `You already have a food called ${clash.name}.`);
    await db.saveFood({
      ...food, name, brand: f.brand.value, portionAmount, portionUnit: f.portionUnit.value,
      barcode: f.barcode.value, favourite: f.favourite.checked,
    });
    closeSheet();
    toast("Food saved");
    render();
  });
}

// ---------------------------------------------------------------- export

// Hands a file to the user: the share sheet on a phone (AirDrop, Mail, Save to Files),
// a download on a computer. Resolves false if the user backed out of the share sheet.
async function deliverFile(file, title) {
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
      // sharing was refused; fall through to a plain download
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return true;
}

// The Export button: confirm, choose how many days back, then hand over an Excel file.
async function openExportFlow() {
  const yes = await confirmSheet({
    title: "Export", body: "Do you want to generate a file?", confirmLabel: "Yes", cancelLabel: "No",
  });
  if (!yes) return;

  const sheet = openSheet(`
    <form class="sheet-form" novalidate>
      ${sheetHead("Export", "Generate")}
      <div class="field"><span>Number of days</span>
        <input name="days" type="text" inputmode="numeric" value="${DEFAULT_EXPORT_DAYS}" autocomplete="off" aria-label="Number of days">
        <div class="chips">${EXPORT_DAY_CHOICES.map((n) =>
          `<button type="button" class="chip" data-days="${n}">${n}</button>`).join("")}</div>
      </div>
      <p class="hint period"></p>
      <p class="hint">Makes an Excel file of every food logged in that period, newest first: date, time, meal, food, quantity, where it came from, your note and the barcode, with each day's pain, period and exercise. Days with nothing logged are listed too.</p>
      <p class="form-error" hidden></p>
    </form>`);
  const form = sheet.querySelector("form");
  const period = form.querySelector(".period");
  const readDays = () => {
    const n = Number(form.elements.days.value.trim());
    return Number.isInteger(n) && n >= 1 && n <= MAX_EXPORT_DAYS ? n : null;
  };
  const refresh = async () => {
    const n = readDays();
    if (!n) {
      period.textContent = `Type a whole number of days, from 1 to ${MAX_EXPORT_DAYS}.`;
      return;
    }
    const { from, to } = exportPeriod(n);
    const count = (await db.entriesBetween(from, to)).length;
    const span = n === 1 ? "Today" : `${fmtDay(from, { weekday: "short", day: "numeric", month: "short" })} to today`;
    period.textContent = `${span} · ${count} ${count === 1 ? "food" : "foods"} logged`;
  };
  form.addEventListener("input", refresh);
  form.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-days]");
    if (chip) setField(form.elements.days, chip.dataset.days);
  });
  refresh();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = readDays();
    if (!n) return showError(form, `The number of days must be a whole number from 1 to ${MAX_EXPORT_DAYS}.`);
    const result = await buildLogExport(n);
    if (!result.count && !result.dayCount) return showError(form, "Nothing is logged in that period, so there is no file to make.");
    closeSheet();
    if (await deliverFile(result.file, "Food log")) toast(`Excel file made: ${result.count} ${result.count === 1 ? "food" : "foods"}`);
  });
}

// ---------------------------------------------------------------- Today

function dueMeals(entries, dismissed) {
  if (!state.reminders.enabled) return [];
  const now = db.timeStr();
  const logged = new Set(entries.map((e) => e.meal));
  const skipped = dismissed?.date === db.dateStr() ? dismissed.meals : [];
  return REMINDED_MEALS.filter((m) =>
    state.reminders.times[m] && now >= state.reminders.times[m] && !logged.has(m) && !skipped.includes(m));
}

function entryRow(e) {
  const sub = [e.time, e.source, e.note].filter(Boolean).map(esc).join(" · ");
  return `
    <li><button type="button" class="row" data-action="edit-entry" data-id="${esc(e.id)}">
      <span class="row-main"><span class="row-title">${esc(e.foodName)}</span><span class="row-sub">${sub}</span></span>
      <span class="row-value">${esc(fmtAmount(e.amount, e.unit))}</span>
    </button></li>`;
}

// A 0 to 10 slider. It starts unset ("–"); a tap sets it, 0 included, and a tap on the
// number clears it again.
function scaleControl(field, label, value) {
  return `
    <span class="scale">
      <span class="scale-label">${label}</span>
      <input type="range" min="0" max="10" step="1" value="${value ?? 0}" data-day="${field}" aria-label="${label}, from 0 to 10">
      <button type="button" class="scale-value" data-clear="${field}" aria-label="Clear ${label.toLowerCase()}">${value ?? "–"}</button>
    </span>`;
}

function dayCard(day) {
  const hidden = day.exercise ? "" : "hidden";
  return `
    <section class="card day-card" aria-label="How the day went">
      <div class="day-row">
        ${state.period.enabled ? `<label class="check"><input type="checkbox" data-day="period" ${day.period ? "checked" : ""}><span>Period</span></label>` : ""}
        ${scaleControl("pain", "Pain", day.pain)}
      </div>
      <input type="text" data-day="painNote" value="${esc(day.painNote)}" placeholder="Note" autocomplete="off" autocapitalize="sentences" aria-label="Pain note">
      <div class="day-row">
        <label class="check"><input type="checkbox" data-day="exercise" ${day.exercise ? "checked" : ""}><span>Exercise</span></label>
        <span class="exercise-detail" ${hidden}>${scaleControl("intensity", "Intensity", day.intensity)}</span>
      </div>
      <input type="text" class="exercise-detail" data-day="exerciseNote" value="${esc(day.exerciseNote)}" placeholder="Note" autocomplete="off" autocapitalize="sentences" aria-label="Exercise note" ${hidden}>
    </section>`;
}

// Every change on the day card is saved straight away; there is no Save button.
function wireDayCard(card, day) {
  const save = () => db.saveDay(day).catch(reportError);
  const showScale = (name) => {
    card.querySelector(`[data-day="${name}"]`).value = day[name] ?? 0;
    card.querySelector(`[data-clear="${name}"]`).textContent = day[name] ?? "–";
  };
  const take = (el) => {
    const name = el.dataset.day;
    if (el.type === "checkbox") day[name] = el.checked;
    else if (el.type === "range") day[name] = Number(el.value);
    else day[name] = el.value;
    if (el.type === "range") showScale(name);
    if (name === "exercise") card.querySelectorAll(".exercise-detail").forEach((x) => { x.hidden = !day.exercise; });
    save();
  };
  card.addEventListener("input", (e) => { if (e.target.dataset.day) take(e.target); });
  card.addEventListener("change", (e) => { if (e.target.dataset.day) take(e.target); });
  card.addEventListener("click", (e) => {
    // a tap on a slider records its value even when the value did not move, so 0 can be set
    if (e.target.type === "range") return take(e.target);
    const clear = e.target.closest("[data-clear]");
    if (!clear) return;
    day[clear.dataset.clear] = null;
    showScale(clear.dataset.clear);
    save();
  });
}

async function renderDay(date) {
  const today = db.dateStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || date > today) date = today;
  const [entries, dismissed, day] = await Promise.all([
    db.entriesForDate(date), db.getSetting("dismissed"), db.getDay(date)]);
  const due = date === today ? dueMeals(entries, dismissed) : [];

  const nudge = due.length ? `
    <section class="card nudge">
      <div class="nudge-head">${ICON.bell}<h2>Not logged yet today</h2></div>
      ${due.map((m) => `
        <div class="nudge-row">
          <span>${MEAL_LABEL[m]}</span>
          <button type="button" class="pill" data-action="add-to" data-meal="${m}" data-date="${esc(date)}">Log</button>
          <button type="button" class="icon-btn" data-action="dismiss-nudge" data-meal="${m}" aria-label="Dismiss ${MEAL_LABEL[m].toLowerCase()} reminder">${ICON.close}</button>
        </div>`).join("")}
    </section>` : "";

  const sections = MEALS.map((m) => {
    const rows = entries.filter((e) => e.meal === m);
    return `
      <section class="card">
        <div class="card-head">
          <i class="dot" style="background: var(${MEAL_COLOR[m]})"></i>
          <h2>${MEAL_LABEL[m]}</h2>
          <button type="button" class="icon-btn" data-action="add-to" data-meal="${m}" data-date="${esc(date)}" aria-label="Add to ${MEAL_LABEL[m].toLowerCase()}">${ICON.plus}</button>
        </div>
        ${rows.length ? `<ul class="rows">${rows.map(entryRow).join("")}</ul>` : '<p class="empty">Nothing logged</p>'}
        ${rows.length >= 2 ? `<button type="button" class="link card-foot" data-action="save-as-meal" data-meal="${m}" data-date="${esc(date)}">Save these as a meal</button>` : ""}
      </section>`;
  }).join("");

  view.innerHTML = `
    <header class="screen-head">
      <div class="head-row">
        <h1>${esc(dayTitle(date))}</h1>
        <button type="button" class="btn" data-action="export-log">${ICON.export} Export</button>
      </div>
      <div class="day-nav">
        <button type="button" class="icon-btn" data-action="go-day" data-date="${db.shiftDate(date, -1)}" aria-label="Previous day">${ICON.chevronLeft}</button>
        <p class="sub">${esc(fmtDay(date, { weekday: "long", day: "numeric", month: "long" }))}</p>
        <button type="button" class="icon-btn" data-action="go-day" data-date="${db.shiftDate(date, 1)}" aria-label="Next day" ${date === today ? "disabled" : ""}>${ICON.chevronRight}</button>
      </div>
    </header>
    ${nudge}${dayCard(day)}${sections}`;
  wireDayCard(view.querySelector(".day-card"), day);
}

// ---------------------------------------------------------------- Add

function foodRow(f) {
  const sub = [f.brand, fmtAmount(f.portionAmount, f.portionUnit)].filter(Boolean).map(esc).join(" · ");
  return `
    <li><button type="button" class="row" data-action="pick-food" data-id="${esc(f.id)}">
      <span class="row-main"><span class="row-title">${esc(f.name)}</span><span class="row-sub">${sub}</span></span>
    </button></li>`;
}

function mealRow(m, action) {
  return `
    <li><button type="button" class="row" data-action="${action}" data-id="${esc(m.id)}">
      <span class="row-main"><span class="row-title">${esc(m.name)}</span>
      <span class="row-sub">${esc(m.items.map((it) => it.foodName).join(", "))}</span></span>
    </button></li>`;
}

const listCard = (title, rowsHtml) =>
  `<section class="card"><div class="card-head"><h2>${esc(title)}</h2></div><ul class="rows">${rowsHtml}</ul></section>`;

function addResults(query, foods, meals) {
  const q = query.trim().toLowerCase();
  if (!q) {
    const favourites = foods.filter((f) => f.favourite);
    const recent = foods.filter((f) => !f.favourite && f.lastUsed)
      .sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 10);
    if (!foods.length && !meals.length) {
      return '<p class="empty-screen">Type a food above to log it. Foods you log are remembered here, so next time it is one tap.</p>';
    }
    return (favourites.length ? listCard("Favourites", favourites.map(foodRow).join("")) : "")
      + (recent.length ? listCard("Recent", recent.map(foodRow).join("")) : "")
      + (meals.length ? listCard("Meals", meals.map((m) => mealRow(m, "pick-meal")).join("")) : "");
  }
  const matches = foods.filter((f) => f.name.toLowerCase().includes(q) || f.brand.toLowerCase().includes(q));
  const mealMatches = meals.filter((m) => m.name.toLowerCase().includes(q));
  const exact = foods.some((f) => f.name.toLowerCase() === q);
  const fresh = exact ? "" : `
    <li><button type="button" class="row" data-action="new-entry" data-name="${esc(query.trim())}">
      <span class="row-main"><span class="row-title">Log “${esc(query.trim())}”</span><span class="row-sub">New food</span></span>
    </button></li>`;
  return `<section class="card"><ul class="rows">${fresh}${matches.map(foodRow).join("")}${mealMatches.map((m) => mealRow(m, "pick-meal")).join("")}</ul></section>`;
}

async function renderAdd() {
  const [foods, meals] = await Promise.all([db.allFoods(), db.allMeals()]);
  const ctx = state.addContext;
  const target = ctx ? `To ${MEAL_LABEL[ctx.meal].toLowerCase()} · ${dayTitle(ctx.date).toLowerCase()}` : "Search your foods, or type a new one";
  view.innerHTML = `
    <header class="screen-head"><h1>Add food</h1><p class="sub">${esc(target)}</p></header>
    <div class="search-row">
      <input id="search" type="search" placeholder="Search or type a food" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" aria-label="Search or type a food">
    </div>
    <div id="results">${addResults("", foods, meals)}</div>`;
  const search = view.querySelector("#search");
  search.addEventListener("input", () => {
    view.querySelector("#results").innerHTML = addResults(search.value, foods, meals);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && search.value.trim()) view.querySelector("#results .row")?.click();
  });
}

// ---------------------------------------------------------------- Saved

async function renderSaved() {
  const showFoods = state.savedSegment === "foods";
  const items = showFoods ? await db.allFoods() : await db.allMeals();
  let body;
  if (showFoods) {
    const sorted = [...items].sort((a, b) => Number(b.favourite) - Number(a.favourite));
    body = sorted.length ? `<section class="card"><ul class="rows">${sorted.map((f) => `
      <li class="row-with-action">
        <button type="button" class="icon-btn star ${f.favourite ? "on" : ""}" data-action="toggle-favourite" data-id="${esc(f.id)}" aria-pressed="${Boolean(f.favourite)}" aria-label="Favourite ${esc(f.name)}">${ICON.star}</button>
        <button type="button" class="row" data-action="edit-food" data-id="${esc(f.id)}">
          <span class="row-main"><span class="row-title">${esc(f.name)}</span>
          <span class="row-sub">${[f.brand, fmtAmount(f.portionAmount, f.portionUnit)].filter(Boolean).map(esc).join(" · ")}</span></span>
        </button>
      </li>`).join("")}</ul></section>`
      : '<p class="empty-screen">No saved foods yet. Every food you log is saved here automatically.</p>';
  } else {
    body = items.length ? `<section class="card"><ul class="rows">${items.map((m) => mealRow(m, "edit-meal")).join("")}</ul></section>`
      : '<p class="empty-screen">No saved meals yet. A meal is a set of foods you often eat together, logged with one tap.</p>';
  }
  view.innerHTML = `
    <header class="screen-head"><h1>Saved</h1></header>
    <div class="toolbar">
      ${segmented("segment", [["foods", "Foods"], ["meals", "Meals"]], state.savedSegment)}
      <button type="button" class="btn" data-action="${showFoods ? "new-food" : "new-meal"}">${ICON.plus} New</button>
    </div>
    ${body}`;
  view.querySelector(".seg").addEventListener("change", (e) => {
    state.savedSegment = e.target.value;
    renderSaved();
  });
}

// ---------------------------------------------------------------- History

function historyBuckets(entries, range, today) {
  const empty = () => Object.fromEntries(MEALS.map((m) => [m, 0]));
  const short = (date) => fmtDay(date, { day: "numeric", month: "short" });
  const buckets = [];
  if (range.weekly) {
    for (let w = range.days / 7 - 1; w >= 0; w--) {
      const from = db.shiftDate(today, -(w * 7 + 6)), to = db.shiftDate(today, -w * 7);
      buckets.push({ from, to, label: short(from), tip: `${short(from)} – ${short(to)}`, showLabel: w % 3 === 0, values: empty() });
    }
  } else {
    for (let d = range.days - 1; d >= 0; d--) {
      const date = db.shiftDate(today, -d);
      const weekday = fmtDay(date, { weekday: "short" });
      buckets.push({
        from: date, to: date, tip: `${weekday} ${short(date)}`, values: empty(),
        label: range.days <= 7 ? weekday : short(date),
        showLabel: range.days <= 7 || d % 7 === 0,
      });
    }
  }
  for (const e of entries) {
    const bucket = buckets.find((b) => e.date >= b.from && e.date <= b.to);
    if (bucket) bucket.values[e.meal]++;
  }
  return buckets;
}

async function renderHistory() {
  const range = RANGES[state.range];
  const today = db.dateStr();
  const from = db.shiftDate(today, -(range.days - 1));
  const entries = await db.entriesBetween(from, today);

  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const daysLogged = byDate.size;
  const mealsPerDay = daysLogged
    ? [...byDate.values()].reduce((sum, list) => sum + new Set(list.map((e) => e.meal)).size, 0) / daysLogged : 0;

  const hours = Array.from({ length: 24 }, () => 0);
  const counts = new Map();
  for (const e of entries) {
    hours[Number(e.time.slice(0, 2))]++;
    const key = e.foodName.toLowerCase();
    counts.set(key, { name: counts.get(key)?.name ?? e.foodName, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  const topFoods = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6);
  const sourceCounts = new Map();
  for (const e of entries) {
    const key = (e.source ?? "").toLowerCase();
    sourceCounts.set(key, { name: sourceCounts.get(key)?.name ?? (e.source || "Not given"), count: (sourceCounts.get(key)?.count ?? 0) + 1 });
  }
  const topSources = [...sourceCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6);
  const dayRows = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, list]) => {
    const meals = new Set(list.map((e) => e.meal));
    return `
      <li><button type="button" class="row" data-action="go-day" data-date="${esc(date)}">
        <span class="row-main"><span class="row-title">${esc(fmtDay(date, { weekday: "short", day: "numeric", month: "short" }))}</span>
        <span class="row-sub">${list.length} ${list.length === 1 ? "entry" : "entries"}</span></span>
        <span class="dots">${MEALS.map((m) => `<i class="dot ${meals.has(m) ? "" : "off"}" style="--c: var(${MEAL_COLOR[m]})" title="${MEAL_LABEL[m]}"></i>`).join("")}</span>
      </button></li>`;
  }).join("");

  const pad2 = (n) => String(n).padStart(2, "0");
  view.innerHTML = `
    <header class="screen-head">
      <div class="head-row">
        <h1>History</h1>
        <button type="button" class="btn" data-action="export-log">${ICON.export} Export</button>
      </div>
    </header>
    <div class="toolbar">${segmented("range", Object.entries(RANGES).map(([k, r]) => [k, r.label]), String(state.range), "seg-wide")}</div>
    ${entries.length ? `
    <div class="tiles">
      <div class="tile"><span class="tile-label">Days logged</span><span class="tile-value">${daysLogged}<small> of ${range.days}</small></span></div>
      <div class="tile"><span class="tile-label">Entries</span><span class="tile-value">${entries.length}</span></div>
      <div class="tile"><span class="tile-label">Meals per day</span><span class="tile-value">${mealsPerDay.toFixed(1)}</span></div>
    </div>
    <section class="card chart-card"><h2>Entries per ${range.weekly ? "week" : "day"}, by meal</h2><div id="chart-days"></div></section>
    <section class="card chart-card"><h2>Time of day</h2><p class="sub">Entries by hour logged</p><div id="chart-hours"></div></section>
    <section class="card chart-card"><h2>Where the food came from</h2><p class="sub">Foods logged per source</p><div id="chart-sources"></div></section>
    <section class="card chart-card"><h2>Most logged foods</h2><p class="sub">Times logged</p><div id="chart-foods"></div></section>
    ${listCard("Days", dayRows)}`
    : '<p class="empty-screen">Nothing logged in this period yet.</p>'}`;

  view.querySelector(".seg").addEventListener("change", (e) => {
    state.range = Number(e.target.value);
    renderHistory();
  });
  if (!entries.length) return;

  columnChart(view.querySelector("#chart-days"), {
    buckets: historyBuckets(entries, range, today),
    series: MEALS.map((m) => ({ key: m, label: MEAL_LABEL[m], color: MEAL_COLOR[m] })),
  });
  columnChart(view.querySelector("#chart-hours"), {
    buckets: hours.map((n, h) => ({
      label: pad2(h), showLabel: h % 6 === 0, tip: `${pad2(h)}:00 – ${pad2(h + 1)}:00`, values: { all: n },
    })),
    series: [{ key: "all", label: "Entries", color: "--series-1" }],
  });
  rankedBars(view.querySelector("#chart-sources"), topSources);
  rankedBars(view.querySelector("#chart-foods"), topFoods);
}

// ---------------------------------------------------------------- Settings

async function renderSettings() {
  const [persisted, lastExport, entries, foods] = await Promise.all([
    navigator.storage?.persisted?.().catch(() => false) ?? false,
    db.getSetting("lastExport"), db.allEntries(), db.allFoods(),
  ]);
  const r = state.reminders;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  view.innerHTML = `
    <header class="screen-head"><h1>Settings</h1></header>

    <section class="card">
      <div class="card-head"><h2>Reminders</h2></div>
      <label class="switch-row"><span>Remind me in the app when a meal is not logged</span>
        <input type="checkbox" data-reminder="enabled" ${r.enabled ? "checked" : ""}></label>
      ${REMINDED_MEALS.map((m) => `
        <div class="switch-row"><span>${MEAL_LABEL[m]} by</span>${timeField(m, r.times[m], !r.enabled)}</div>`).join("")}
      <p class="hint">Shown on the Today screen when you open the app. The app cannot send notifications while it is closed.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Period</h2></div>
      <label class="switch-row"><span>Show the Period checkbox on the Today screen</span>
        <input type="checkbox" data-setting="period" ${state.period.enabled ? "checked" : ""}></label>
      <p class="hint">When this is off, the checkbox is hidden and the Excel file has no Period column. Pain and exercise stay.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Backup</h2></div>
      <p class="hint">Your log is stored only on this phone. Save a backup file now and then, and keep it somewhere safe. A backup restores the whole app; for a file to read on a computer, use Export on the Today screen.</p>
      <p class="hint">Last backup: ${lastExport ? esc(new Date(lastExport).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" })) : "never"}</p>
      <div class="button-row">
        <button type="button" class="btn primary" data-action="backup-save">Save backup</button>
        <button type="button" class="btn" data-action="backup-restore">Restore backup</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </section>

    ${standalone ? "" : `
    <section class="card">
      <div class="card-head"><h2>Add to Home Screen</h2></div>
      <p class="hint">In Safari, tap the Share button, then “Add to Home Screen”. The app then opens full-screen and works without a connection.</p>
    </section>`}

    <section class="card">
      <div class="card-head"><h2>About</h2></div>
      <ul class="plain-list">
        <li><span>Version</span><span class="muted">${APP_VERSION}</span></li>
        <li><span>Entries</span><span class="muted">${entries.length}</span></li>
        <li><span>Saved foods</span><span class="muted">${foods.length}</span></li>
        <li><span>Protected from automatic clean-up</span><span class="muted">${persisted ? "Yes" : "No"}</span></li>
      </ul>
    </section>`;

  const saveReminders = async (next) => {
    state.reminders = next;
    await db.setSetting("reminders", next);
    renderSettings();
  };
  view.querySelector('[data-reminder="enabled"]').addEventListener("change", (e) =>
    saveReminders({ enabled: e.target.checked, times: r.times }));
  for (const m of REMINDED_MEALS) {
    view.querySelector(`[data-time="${m}"]`).addEventListener("change", () =>
      saveReminders({ enabled: r.enabled, times: { ...r.times, [m]: readTime(view, m) } }));
  }
  view.querySelector('[data-setting="period"]').addEventListener("change", async (e) => {
    state.period = { enabled: e.target.checked };
    await db.setSetting("period", state.period);
  });
  view.querySelector("#import-file").addEventListener("change", (e) => importBackup(e.target.files[0]));
}

async function saveBackup() {
  const data = await db.exportData();
  const file = new File([JSON.stringify(data, null, 1)], `foodlog-backup-${db.dateStr()}.json`, { type: "application/json" });
  if (!(await deliverFile(file, "Food Log backup"))) return;
  await db.setSetting("lastExport", Date.now());
  render();
}

async function importBackup(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast("That file could not be read as a backup.");
  }
  const ok = await confirmSheet({
    title: "Replace your log?",
    body: "Restoring replaces everything in the app with the contents of the backup file. This cannot be undone.",
    confirmLabel: "Replace with backup", danger: true,
  });
  if (!ok) return render();
  try {
    const counts = await db.importData(data);
    state.reminders = await db.getSetting("reminders", DEFAULT_REMINDERS);
    state.period = await db.getSetting("period", DEFAULT_PERIOD);
    toast(`Restored ${counts.entries} entries and ${counts.foods} foods`);
  } catch (err) {
    toast(err.message);
  }
  render();
}

// ---------------------------------------------------------------- actions

const ACTIONS = {
  "close-sheet": () => closeSheet(),

  "go-day": ({ date }) => goToDay(date),

  "add-to": ({ meal, date }) => {
    state.addContext = { meal, date };
    if (location.hash === "#add") render();
    else location.hash = "#add";
  },

  "dismiss-nudge": async ({ meal }) => {
    const today = db.dateStr();
    const current = await db.getSetting("dismissed");
    const meals = current?.date === today ? current.meals : [];
    await db.setSetting("dismissed", { date: today, meals: [...meals, meal] });
    render();
  },

  "edit-entry": async ({ id }) => {
    const entry = await db.getEntry(id);
    if (!entry) return render();
    const food = entry.foodId ? await db.getFood(entry.foodId) : null;
    return openEntrySheet({ entry, food });
  },

  "delete-entry": async ({ id }) => {
    await db.deleteEntry(id);
    closeSheet();
    toast("Entry deleted");
    render();
  },

  "save-as-meal": async ({ meal, date }) => {
    const entries = (await db.entriesForDate(date)).filter((e) => e.meal === meal);
    openMealSheet(null, entries.map((e) => ({ foodId: e.foodId, foodName: e.foodName, amount: e.amount, unit: e.unit })));
  },

  "new-entry": ({ name }) => openEntrySheet({ name, ...(state.addContext ?? {}) }),

  "pick-food": async ({ id }) => openEntrySheet({ food: await db.getFood(id), ...(state.addContext ?? {}) }),

  "pick-meal": async ({ id }) => {
    const ctx = state.addContext;
    return openLogMealSheet(await db.getMeal(id), { slot: ctx?.meal, date: ctx?.date });
  },

  "export-log": () => openExportFlow(),

  "new-food": () => openFoodSheet(),
  "edit-food": async ({ id }) => openFoodSheet(await db.getFood(id)),
  "toggle-favourite": async ({ id }) => {
    const food = await db.getFood(id);
    await db.saveFood({ ...food, favourite: !food.favourite });
    render();
  },
  "delete-food": async ({ id }) => {
    const food = await db.getFood(id);
    const ok = await confirmSheet({
      title: `Delete ${food.name}?`,
      body: "It is removed from your saved foods. Entries you have already logged are kept.",
      confirmLabel: "Delete food", danger: true,
    });
    if (!ok) return;
    await db.deleteFood(id);
    toast("Food deleted");
    render();
  },

  "new-meal": () => openMealSheet(),
  "edit-meal": async ({ id }) => openMealSheet(await db.getMeal(id)),
  "delete-meal": async ({ id }) => {
    await db.deleteMeal(id);
    closeSheet();
    toast("Meal deleted");
    render();
  },

  "backup-save": () => saveBackup(),
  "backup-restore": () => view.querySelector("#import-file").click(),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  const action = el && ACTIONS[el.dataset.action];
  if (!action) return;
  e.preventDefault();
  Promise.resolve(action(el.dataset, el)).catch(reportError);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheetOpen()) closeSheet();
});

function reportError(err) {
  console.error(err);
  toast(`Something went wrong: ${err?.message ?? err}`);
}

// ---------------------------------------------------------------- routing

const SCREENS = {
  today: (arg) => renderDay(arg),
  history: renderHistory,
  add: renderAdd,
  saved: renderSaved,
  settings: renderSettings,
};

async function render() {
  const [name, arg] = location.hash.slice(1).split("/");
  const tab = TABS.includes(name) ? name : "today";
  if (tab !== "add") state.addContext = null;
  document.querySelectorAll(".tabbar a").forEach((a) =>
    a.toggleAttribute("aria-current", a.dataset.tab === tab));
  try {
    await SCREENS[tab](arg);
  } catch (err) {
    reportError(err);
  }
  if (state.lastTab !== tab) window.scrollTo(0, 0);
  state.lastTab = tab;
}

window.addEventListener("hashchange", () => {
  closeSheet();
  render();
});

// Coming back to the app later in the day: refresh, so the date and reminders are current.
document.addEventListener("visibilitychange", () => {
  const typing = document.activeElement?.matches?.("input[type=text], input[type=search], textarea");
  if (!document.hidden && !sheetOpen() && !typing) render();
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.lastTab === "history" && !sheetOpen()) render();
  }, 200);
});

async function start() {
  state.reminders = await db.getSetting("reminders", DEFAULT_REMINDERS);
  state.period = await db.getSetting("period", DEFAULT_PERIOD);
  await render();
  db.requestPersistence();
  // The service worker makes the app open offline. On localhost it is off unless ?sw is
  // in the address, so edits show up on reload while developing.
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && (!local || new URLSearchParams(location.search).has("sw"))) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker not registered", err));
  }
}

start().catch(reportError);
