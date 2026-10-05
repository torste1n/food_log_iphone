// Writes an Excel workbook (.xlsx) with no library. An .xlsx file is a zip of a few XML
// files; this builds those and zips them uncompressed, which Excel reads fine and keeps
// the app small and fully offline.
//
//   buildWorkbook([{ name, columns: [{ header, width, type }], rows: [[...]] }])  ->  Uint8Array
//
// Column types: "text" (default), "number", "date" ("YYYY-MM-DD" in, a real Excel date out)
// and "time" ("HH:MM" in, a real Excel time out). Empty cells are null, undefined or "".

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// cell styles, by position in <cellXfs> below
const STYLE = { header: 1, date: 2, time: 3 };

// Characters XML cannot hold are dropped; the five special ones are escaped.
const xml = (s) => String(s)
  .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
  .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

// 0 -> A, 25 -> Z, 26 -> AA
function columnName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

// Excel counts days from 30 December 1899.
export function excelDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

export function excelTime(time) {
  const [h, min] = time.split(":").map(Number);
  return (h * 60 + min) / 1440;
}

function cell(ref, value, type) {
  if (value === null || value === undefined || value === "") return "";
  // A value that is not what its column expects is written as text, so the file stays readable.
  const number = type === "number" ? Number(value) : type === "date" ? excelDate(String(value))
    : type === "time" ? excelTime(String(value)) : NaN;
  if (Number.isFinite(number)) {
    const style = type === "number" ? "" : ` s="${STYLE[type]}"`;
    return `<c r="${ref}"${style}><v>${number}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheetXml(sheet, first) {
  const { columns, rows } = sheet;
  const lastCell = `${columnName(columns.length - 1)}${rows.length + 1}`;
  const header = columns.map((col, c) =>
    `<c r="${columnName(c)}1" s="${STYLE.header}" t="inlineStr"><is><t>${xml(col.header)}</t></is></c>`).join("");
  const body = rows.map((row, r) =>
    `<row r="${r + 2}">${columns.map((col, c) => cell(`${columnName(c)}${r + 2}`, row[c], col.type)).join("")}</row>`).join("");
  return `${XML_HEAD}<worksheet xmlns="${MAIN_NS}">`
    + `<dimension ref="A1:${lastCell}"/>`
    // the header row stays in view while scrolling
    + `<sheetViews><sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ""}>`
    + `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${columns.map((col, c) =>
        `<col min="${c + 1}" max="${c + 1}" width="${col.width ?? 14}" customWidth="1"/>`).join("")}</cols>`
    + `<sheetData><row r="1">${header}</row>${body}</sheetData>`
    + `<autoFilter ref="A1:${lastCell}"/>`
    + `</worksheet>`;
}

const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">`
  + `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="hh:mm"/></numFmts>`
  + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
  + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
  + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
  + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
  + `<cellXfs count="4">`
  + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
  + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
  + `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
  + `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
  + `</cellXfs>`
  + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
  + `</styleSheet>`;

// Sheet names may not contain []:*?/\ and are at most 31 characters.
const sheetName = (name) => String(name).replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";

export function buildWorkbook(sheets) {
  const files = [
    ["[Content_Types].xml", `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
      + `</Types>`],
    ["_rels/.rels", `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">`
      + `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">`
      + `<bookViews><workbookView/></bookViews>`
      + `<sheets>${sheets.map((s, i) => `<sheet name="${xml(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>`
      + `</workbook>`],
    ["xl/_rels/workbook.xml.rels", `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">`
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
      + `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", STYLES_XML],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, i === 0)]),
  ];
  return zip(files);
}

// ---------------------------------------------------------------- zip (stored, no compression)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const UTF8_NAMES = 0x0800;

  const entries = files.map(([path, text]) => {
    const data = encoder.encode(text);
    return { name: encoder.encode(path), data, crc: crc32(data) };
  });
  const dataSize = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const dirSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  const out = new Uint8Array(dataSize + dirSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;
  const u16 = (v) => { view.setUint16(pos, v, true); pos += 2; };
  const u32 = (v) => { view.setUint32(pos, v, true); pos += 4; };
  const raw = (bytes) => { out.set(bytes, pos); pos += bytes.length; };

  for (const e of entries) {
    e.offset = pos;
    u32(0x04034b50); u16(20); u16(UTF8_NAMES); u16(0); u16(dosTime); u16(dosDate);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0);
    raw(e.name); raw(e.data);
  }
  const dirStart = pos;
  for (const e of entries) {
    u32(0x02014b50); u16(20); u16(20); u16(UTF8_NAMES); u16(0); u16(dosTime); u16(dosDate);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length);
    u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
    raw(e.name);
  }
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length);
  u32(dirSize); u32(dirStart); u16(0);
  return out;
}
