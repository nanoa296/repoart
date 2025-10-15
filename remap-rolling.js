#!/usr/bin/env node
/**
 * remap-rolling.js (centered, UTC-safe)
 * - Strips nested repo/network lines from the template.
 * - Centers the art within the last 52 weeks of activity (UTC-based window).
 * - Emits all dates as 12:00:00 GMT+0000 (UTC) to avoid DST rollovers.
 *
 * Usage: node remap-rolling.js template.sh > paint.sh
 */
const fs = require('fs');

const fullDateRe =
  /[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{2}\s2019\s\d{2}:\d{2}:\d{2}\sGMT[+-]\d{4}\s\([^)]+\)/g;
const DAY = 86400000;
const WINDOW_WEEKS = 52;
const WINDOW_DAYS = WINDOW_WEEKS * 7;

function weekSunday(dUTCms) {
  const d = new Date(dUTCms);
  const wd = d.getUTCDay();               // 0=Sun..6=Sat
  return dUTCms - wd * DAY;               // back to Sunday 00:00 UTC
}
function gridStart(year) {
  const jan1 = Date.UTC(year, 0, 1);
  const wd = new Date(jan1).getUTCDay();
  return jan1 - wd * DAY;                 // Sunday on/before Jan 1
}
// Parse ONLY the date part; ignore whatever offset the template had.
function parseFullDayUTC(s) {
  const m = s.match(/^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{2}) (\d{4}) /);
  if (!m) throw new Error("Cannot parse date: " + s);
  const monStr = m[2], dd = +m[3], yyyy = +m[4];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return Date.UTC(yyyy, months.indexOf(monStr), dd, 0, 0, 0);
}
function fmtFullUTCNoon(dayUTCms) {
  const d = new Date(dayUTCms + 12*3600*1000);
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()];
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
  const dd  = String(d.getUTCDate()).padStart(2,'0');
  const yyyy= d.getUTCFullYear();
  return `${dow} ${mon} ${dd} ${yyyy} 12:00:00 GMT+0000 (UTC)`;
}

function main() {
  const path = process.argv[2];
  if (!path) { console.error("Usage: node remap-rolling.js template.sh > paint.sh"); process.exit(2); }
  let input = fs.readFileSync(path, 'utf8');

  // Sanitize template so we paint in the repo root (no nested repo/network)
  const drop = [
    /^mkdir\s+github_painter.*$/gm,
    /^cd\s+github_painter.*$/gm,
    /^git\s+init.*$/gm,
    /^git\s+remote\s+add\s+origin.*$/gm,
    /^git\s+pull\s+origin.*$/gm
  ];
  for (const re of drop) input = input.replace(re, '');

  // Collect original (2019) message dates as anchors
  const msgRe = new RegExp(String.raw`(?:^|\n)git\s+commit\s+--date='[^']*'\s+-m\s+'(` + fullDateRe.source + String.raw`)'`, 'gm');
  const msgs = [];
  let mm;
  while ((mm = msgRe.exec(input)) !== null) msgs.push(mm[1]);
  if (!msgs.length) { process.stdout.write(input); return; }

  const start2019 = gridStart(2019);
  const idxs = msgs.map(s => Math.floor((parseFullDayUTC(s) - start2019)/DAY));
  const minIdx = Math.min(...idxs);
  const maxIdx = Math.max(...idxs);

  // Rolling window: last 52 weeks ending today (UTC)
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const windowStart = weekSunday(todayUTC) - WINDOW_DAYS*DAY; // inclusive start

  // Center the art within the rolling window when possible.
  const baseEarliest = start2019 + minIdx*DAY;
  const artDays = maxIdx - minIdx + 1;
  let anchorEarliest = windowStart;
  if (artDays < WINDOW_DAYS) {
    const freeDays = WINDOW_DAYS - artDays;
    const leftPad = Math.floor(freeDays / 2);
    anchorEarliest += leftPad * DAY;
  }

  const windowEnd = windowStart + (WINDOW_DAYS - 1) * DAY;
  const maxAnchor = windowEnd - (artDays - 1) * DAY;
  if (maxAnchor >= windowStart) {
    if (anchorEarliest > maxAnchor) anchorEarliest = maxAnchor;
    if (anchorEarliest < windowStart) anchorEarliest = windowStart;
  } else {
    anchorEarliest = maxAnchor;
  }

  function remap(fullStr) {
    const oldDay = parseFullDayUTC(fullStr);
    const offset = Math.floor((oldDay - baseEarliest) / DAY);
    const newDay = anchorEarliest + offset * DAY;
    return fmtFullUTCNoon(newDay);
  }

  // Replace echo dates and both --date / -m dates
  const echoRe   = new RegExp(String.raw`(echo\s+')(` + fullDateRe.source + String.raw`)('\s*>>\s*foobar\.txt)`, 'g');
  input = input.replace(echoRe, (_, a, full, c) => a + remap(full) + c);

  const commitRe = new RegExp(String.raw`(git\s+commit\s+--date=')([^']*)('\s+-m\s+')(` + fullDateRe.source + String.raw`)(')`, 'g');
  input = input.replace(commitRe, (_, a, any, b, msg, e) => {
    const mapped = remap(msg);
    return a + mapped + b + mapped + e;
  });

  process.stdout.write(input);
}
main();
