#!/usr/bin/env node
/**
 * Remap a github-painter template into the current rolling 52-week window.
 * Strips git/network setup lines so the template is safe to run in CI.
 * Usage: node remap-rolling.js template.sh > paint.sh
 */
const fs = require('fs');

const fullDateRe =
  /[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{2}\s2019\s\d{2}:\d{2}:\d{2}\sGMT[+-]\d{4}\s\([^)]+\)/g;

function weekSunday(d) {
  const wd = d.getUTCDay(); // 0=Sun..6=Sat
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  out.setUTCDate(out.getUTCDate() - wd);
  return out;
}

function gridStart(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const wd = jan1.getUTCDay(); // 0=Sun
  const out = new Date(jan1);
  out.setUTCDate(out.getUTCDate() - wd);
  return out;
}

function parseFull(s) {
  const m = s.match(/^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT([+-]\d{4}) \(([^)]+)\)$/);
  if (!m) throw new Error("Cannot parse date: " + s);
  const [, , mon, dd, yyyy] = m;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const M = months.indexOf(mon);
  const y = +yyyy;
  const d = +dd;
  return Date.UTC(y, M, d, 0, 0, 0);
}

function fmtFullUTCNoon(utcDayMs) {
  const date = new Date(utcDayMs + 12*3600*1000);
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][date.getUTCDay()];
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][date.getUTCMonth()];
  const dd = String(date.getUTCDate()).padStart(2,'0');
  const yyyy = date.getUTCFullYear();
  return `${dow} ${mon} ${dd} ${yyyy} 12:00:00 GMT+0000 (UTC)`;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node remap-rolling.js template.sh > paint.sh");
    process.exit(2);
  }
  let input = fs.readFileSync(path, 'utf8');

  const dropPatterns = [
    /^mkdir\s+github_painter.*$/gm,
    /^cd\s+github_painter.*$/gm,
    /^git\s+init.*$/gm,
    /^git\s+remote\s+add\s+origin.*$/gm,
    /^git\s+pull\s+origin.*$/gm
  ];
  for (const re of dropPatterns) input = input.replace(re, '');

  const msgRe = new RegExp(
    String.raw`(?:^|\n)git\s+commit\s+--date='[^']*'\s+-m\s+'(` + fullDateRe.source + String.raw`)'`,
    'gm'
  );
  const msgs = [];
  let mm;
  while ((mm = msgRe.exec(input)) !== null) {
    msgs.push(mm[1]);
  }
  if (msgs.length === 0) {
    process.stdout.write(input);
    return;
  }

  const start2019 = gridStart(2019).getTime();
  const idxs = msgs.map(s => {
    const dayUtc = parseFull(s);
    return Math.floor((dayUtc - start2019) / 86400000);
  });
  const minIdx = Math.min(...idxs);
  const maxIdx = Math.max(...idxs);
  const span = maxIdx - minIdx;

  // Rolling window
  const now = new Date(); // current time
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const thisWeekSun = weekSunday(new Date(todayUTC)).getTime();
  const rollingStart = thisWeekSun - 52*7*86400000; // 52 weeks

  const startCandidate = todayUTC - span*86400000;

  const newBase = Math.max(startCandidate, rollingStart);
  const baseOld = start2019 + minIdx * 86400000;

  function remapFull(fullStr) {
    const oldDayUtc = parseFull(fullStr);
    const offsetDays = Math.floor((oldDayUtc - baseOld) / 86400000);
    const newDayUtc = newBase + offsetDays*86400000;
    return fmtFullUTCNoon(newDayUtc);
  }

  // 1) echo lines
  const echoRe = new RegExp(
    String.raw`(echo\s+')(` + fullDateRe.source + String.raw`)('\s*>>\s*foobar\.txt)`,
    'g'
  );
  let out = input.replace(echoRe, (_, a, full, c) => a + remapFull(full) + c );

  // 2) commit lines: replace both --date='...' and the -m '...'
  const commitRe = new RegExp(
    String.raw`(git\s+commit\s+--date=')([^']*)('\s+-m\s+')(` + fullDateRe.source + String.raw`)(')`,
    'g'
  );
  out = out.replace(commitRe, (_, a, any, b, msg, e) => {
    const newFull = remapFull(msg);
    return a + newFull + b + newFull + e;
  });

  process.stdout.write(out);
}

main();
