#!/usr/bin/env node
/**
 * remap-rolling.js — column-aligned, UTC-safe, selectable alignment
 *
 * What it does
 * - Reads a github-painter-style template.sh (with 2019 dates in echo/commit lines)
 * - Strips nested `git init/remote/pull/cd` so painting happens in the repo root
 * - Maps dates by (week column, weekday row) into the profile’s rolling grid
 * - Uses 53 visible weeks (GitHub’s profile grid width)
 * - Emits all commit dates as 12:00:00 GMT+0000 (UTC) to avoid DST shearing
 * - Alignment: 'left' | 'center' | 'right' (default 'left' for your layout)
 *
 * Usage: node remap-rolling.js template.sh > paint.sh
 */

const fs = require("fs");

// Full 2019-style date string as produced by github-painter templates
const FULL_2019 =
  /[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{2}\s2019\s\d{2}:\d{2}:\d{2}\sGMT[+-]\d{4}\s\([^)]+\)/g;

const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function gridStartUTC(year) {
  // Sunday on/before Jan 1
  const jan1 = Date.UTC(year, 0, 1);
  const wd = new Date(jan1).getUTCDay();    // 0=Sun..6=Sat
  return jan1 - wd * 86400000;
}
function weekStartUTC(dayUTCms) {
  const wd = new Date(dayUTCms).getUTCDay();
  return dayUTCms - wd * 86400000;          // Sunday 00:00 UTC of that week
}
function parseFullDayUTC(s) {
  // "Thu Jan 24 2019 00:00:00 GMT-0500 (Eastern Standard Time)" -> 2019-01-24 @ 00:00 UTC
  const m = s.match(/^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{2}) (\d{4}) /);
  if (!m) throw new Error("Bad date: " + s);
  const monStr = m[2], dd = +m[3], yyyy = +m[4];
  return Date.UTC(yyyy, MON.indexOf(monStr), dd, 0, 0, 0);
}
function fmtUTCNoon(dayUTCms) {
  const d = new Date(dayUTCms + 12 * 3600 * 1000); // noon UTC
  const dow = DOW[d.getUTCDay()];
  const mon = MON[d.getUTCMonth()];
  const dd  = String(d.getUTCDate()).padStart(2, "0");
  const yyyy= d.getUTCFullYear();
  return `${d
