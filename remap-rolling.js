#!/usr/bin/env node
/**
 * remap-rolling-colalign.js
 * - Reads github-painter-style template.sh (2019 dates)
 * - Strips nested git init/remote/pull/cd
 * - Maps by (week column, weekday row):
 *     * compute (col,row) for each original 2019 date
 *     * shift cols so max original col == current week col
 * - Emits all commits as 12:00:00 GMT+0000 (UTC) to avoid DST shearing
 *
 * Usage: node remap-rolling-colalign.js template.sh > paint.sh
 */
const fs = require('fs');

const FULL_2019 =
  /[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{2}\s2019\s\d{2}:\d{2}:\d{2}\sGMT[+-]\d{4}\s\([^)]+\)/g;

const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function gridStartUTC(year) {
  // Sunday on/before Jan 1
  const jan1 = Date.UTC(year,0,1);
  const wd = new Date(jan1).getUTCDay();     // 0=Sun..6=Sat
  return jan1 - wd*86400000;
}
function weekStartUTC(dayUTCms) {
  const wd = new Date(dayUTCms).getUTCDay(); // 0=Sun..6=Sat
  return dayUTCms - wd*86400000;
}
function parseFullDayUTC(s) {
  // "Thu Jan 24 2019 00:00:00 GMT-0500 (Eastern Standard Time)" -> 2019-01-24T00:00Z day
  const m = s.match(/^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{2}) (\d{4}) /);
  if (!m) throw new Error("Bad date: " + s);
  const monStr = m[2], dd = +m[3], yyyy = +m[4];
  return Date.UTC(yyyy, MON.indexOf(monStr), dd, 0, 0, 0);
}
function fmtUTCNoon(dayUTCms) {
  const d = new Date(dayUTCms + 12*3600*1000);
  const dow = DOW[d.getUTCDay()];
  const mon = MON[d.getUTCMonth()];
  const dd  = String(d.getUTCDate()).padStart(2,'0');
  const yyyy= d.getUTCFullYear();
  return `${dow} ${mon} ${dd} ${yyyy} 12:00:00 GMT+0000 (UTC)`;
}
function toColRow(idx) { return { col: Math.floor(idx/7), row: idx % 7 }; }
function fromColRow(col,row) { return col*7 + row; }

function main() {
  const path = process.argv[2];
  if (!path) { console.error("Usage: node remap-rolling-colalign.js template.sh > paint.sh"); process.exit(2); }
  let input = fs.readFileSync(path, "utf8");

  // Remove nested repo/network lines so we paint in the root
  [
    /^mkdir\s+github_painter.*$/gm,
    /^cd\s+github_painter.*$/gm,
    /^git\s+init.*$/gm,
    /^git\s+remote\s+add\s+origin.*$/gm,
    /^git\s+pull\s+origin.*$/gm,
  ].forEach(re => input = input.replace(re, ""));

  // Grab all original dates from commit messages (anchor truth)
  const msgRe = new RegExp(String.raw`(?:^|\n)git\s+commit\s+--date='[^']*'\s+-m\s+'(` + FULL_2019.source + String.raw`)'`,"gm");
  const msgs = [];
  for (let m; (m = msgRe.exec(input)) !== null;) msgs.push(m[1]);
  if (!msgs.length) { process.stdout.write(input); return; }

  const start2019 = gridStartUTC(2019);
  const idxs = msgs.map(s => Math.floor((parseFullDayUTC(s) - start2019)/86400000));  // day index from 2019 grid start
  const colRows = idxs.map(toColRow);
  const minCol = Math.min(...colRows.map(x=>x.col));
  const maxCol = Math.max(...colRows.map(x=>x.col));

  // Rolling grid:
  // - GitHub's rightmost column is the week containing TODAY.
  // - We'll use 52 weeks back from the Sunday of this week (52 columns visible).
  const now = new Date();
  const todayUTC   = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const thisSunUTC = weekStartUTC(todayUTC);
  const windowStartUTC = thisSunUTC - 51*7*86400000; // 52 columns: weeks [0..51], 51 is current week
  const windowStartIdx = 0;                           // by definition
  const targetMaxCol   = 51;                          // align latest col to the rightmost column

  // Column shift to right-align
  const shiftCols = targetMaxCol - maxCol;

  // If shifting would push earliest used columns before the window, shift right so earliestCol >= 0
  const earliestShiftedCol = minCol + shiftCols;
  const finalShiftCols     = earliestShiftedCol < 0 ? (shiftCols - earliestShiftedCol) : shiftCols;

  function remapOne(fullStr) {
    const dayIdx2019 = Math.floor((parseFullDayUTC(fullStr) - start2019)/86400000);
    const {col,row} = toColRow(dayIdx2019);
    const newIdxFromWindowStart = fromColRow(col + finalShiftCols, row); // guaranteed >= 0 and <= 51*7+6
    const newDayUTC = windowStartUTC + newIdxFromWindowStart*86400000;
    return fmtUTCNoon(newDayUTC);
  }

  // Replace echo line dates
  const echoRe = new RegExp(String.raw`(echo\s+')(` + FULL_2019.source + String.raw`)('\s*>>\s*foobar\.txt)`, "g");
  input = input.replace(echoRe, (_,a,date,c) => a + remapOne(date) + c);

  // Replace both --date and -m in commit lines using msg as source of truth
  const commitRe = new RegExp(String.raw`(git\s+commit\s+--date=')([^']*)('\s+-m\s+')(` + FULL_2019.source + String.raw`)(')`, "g");
  input = input.replace(commitRe, (_,a,any,b,msg,e) => {
    const mapped = remapOne(msg);
    return a + mapped + b + mapped + e;
  });

  process.stdout.write(input);
}
main();
