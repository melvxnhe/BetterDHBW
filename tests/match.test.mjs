// Tests for the Freistunden-Matcher's logic in src/render.js: when two
// courses are both free. No server needed; the times are Berlin wall-clock.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berlin, hm, partsOf, matchDay, matchWeeks, matchNext, matchHTML, matchNextHTML } from '../src/render.js';

// an event on a day in November 2026 (Monday the 9th): ev(9, '08:45', '12:00')
const ev = (day, from, to, name = 'Vorlesung', month = 11, toDay = day) => {
  const [h1, m1] = from.split(':').map(Number), [h2, m2] = to.split(':').map(Number);
  return { name, start: berlin(2026, month, day, h1, m1), end: berlin(2026, month, toDay, h2, m2) };
};
const dayOf = (day, month = 11) => [berlin(2026, month, day), berlin(2026, month, day + 1)];
const clock = (spans) => spans.map(([a, b]) => `${hm(partsOf(a))}-${hm(partsOf(b))}`);
const at = (t) => hm(partsOf(t));

test('a gap between the two courses’ lectures is a Freistunde, and both are done after the last one', () => {
  const a = [ev(9, '08:45', '12:00')];
  const b = [ev(9, '09:00', '10:30'), ev(9, '13:00', '15:30')];
  const d = matchDay(a, b, ...dayOf(9));
  assert.deepEqual(clock(d.gaps), ['12:00-13:00']);
  assert.equal(at(d.after), '15:30');
  assert.equal(d.free, false);
  assert.deepEqual(clock(d.busyA), ['08:45-12:00']);
  assert.deepEqual(clock(d.busyB), ['09:00-10:30', '13:00-15:30']);
});

test('breaks shorter than 30 minutes are not Freistunden', () => {
  const d = matchDay([ev(9, '08:45', '10:15')], [ev(9, '10:30', '12:00'), ev(9, '12:30', '14:00')], ...dayOf(9));
  assert.deepEqual(clock(d.gaps), ['12:00-12:30'], 'exactly 30 minutes counts');
  const short = matchDay([ev(9, '08:45', '10:15')], [ev(9, '10:30', '12:00')], ...dayOf(9));
  assert.deepEqual(short.gaps, []);
});

test('overlapping and parallel lectures count once', () => {
  const a = [ev(9, '08:00', '10:00'), ev(9, '09:30', '11:00'), ev(9, '09:30', '11:00', 'Gruppe B')];
  const d = matchDay(a, [ev(9, '10:00', '10:30'), ev(9, '14:00', '15:00')], ...dayOf(9));
  assert.deepEqual(clock(d.busyA), ['08:00-11:00']);
  assert.deepEqual(clock(d.gaps), ['11:00-14:00']);
});

test('a day without anything for either is free; one course alone still has its end', () => {
  const free = matchDay([ev(10, '08:00', '09:00')], [], ...dayOf(9));
  assert.equal(free.free, true);
  assert.deepEqual(free.gaps, []);
  assert.equal(free.after, null);
  const one = matchDay([ev(9, '08:00', '09:00'), ev(9, '11:00', '12:00')], [], ...dayOf(9));
  assert.deepEqual(clock(one.gaps), ['09:00-11:00'], 'the other course has nothing: free whenever the first is');
  assert.equal(at(one.after), '12:00');
});

test('all-day and multi-day entries fill the day: no Freistunde, no "ab"', () => {
  const allDay = matchDay([{ name: 'Tag der offenen Tür', start: berlin(2026, 11, 9), end: berlin(2026, 11, 10) }], [ev(9, '10:00', '11:00')], ...dayOf(9));
  assert.deepEqual(allDay.gaps, []);
  assert.equal(allDay.after, null);
  const trip = [ev(9, '08:00', '17:00', 'Exkursion', 11, 11)]; // Monday 08:00 to Wednesday 17:00
  const tuesday = matchDay(trip, [ev(10, '13:00', '14:00')], ...dayOf(10));
  assert.deepEqual(tuesday.busyA.map(([a, b]) => b - a), [24 * 36e5], 'Tuesday is covered from midnight to midnight');
  assert.deepEqual(tuesday.gaps, []);
  const wednesday = matchDay(trip, [], ...dayOf(11));
  assert.equal(at(wednesday.after), '17:00');
});

test('days are Berlin days, also when the clocks change', () => {
  // 25 October 2026: the clocks go back, the day has 25 hours
  const a = [ev(25, '08:00', '10:00', 'x', 10), ev(25, '12:00', '13:00', 'x', 10)];
  const weeks = matchWeeks(a, [], berlin(2026, 10, 20));
  const sunday = weeks.flatMap((w) => w.days).find((d) => d.key === '2026-10-25');
  assert.equal(sunday.to - sunday.from, 25 * 36e5);
  assert.deepEqual(clock(sunday.gaps), ['10:00-12:00']);
});

test('weeks run from the first to the last week of both courses, weekends only when something is on', () => {
  const a = [ev(9, '08:00', '10:00'), ev(14, '09:00', '12:00')]; // a Saturday make-up session
  const b = [ev(23, '08:00', '10:00')];
  const weeks = matchWeeks(a, b, berlin(2026, 11, 1));
  assert.deepEqual(weeks.map((w) => w.kw), [46, 47, 48]);
  assert.deepEqual(weeks[0].days.map((d) => d.weekday), ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']);
  assert.equal(weeks[1].days.length, 5);
  assert.ok(weeks[1].days.every((d) => d.free), 'a week neither has anything in: every day free');
});

test('the next shared free time: a running Freistunde, a later one, or the end of a day', () => {
  const a = [ev(9, '08:45', '12:00'), ev(10, '09:00', '11:00')];
  const b = [ev(9, '13:00', '15:30'), ev(10, '09:00', '10:00'), ev(10, '12:00', '13:00')];
  const weeks = matchWeeks(a, b, berlin(2026, 11, 9, 7));
  const during = matchNext(weeks, berlin(2026, 11, 9, 12, 30));
  assert.deepEqual([at(during.from), at(during.to), during.open], ['12:00', '13:00', false]);
  const evening = matchNext(weeks, berlin(2026, 11, 9, 16));
  assert.deepEqual([evening.day.key, at(evening.from), evening.open], ['2026-11-09', '15:30', true]);
  const tomorrow = matchNext(weeks, berlin(2026, 11, 10, 7));
  assert.deepEqual([tomorrow.day.key, at(tomorrow.from), at(tomorrow.to)], ['2026-11-10', '11:00', '12:00']);
  assert.match(matchNextHTML(weeks, berlin(2026, 11, 9, 12, 30)), /Gerade gemeinsam frei[\s\S]*Jetzt, bis 13:00[\s\S]*30 Min\. noch/);
  assert.equal(matchNext(weeks, berlin(2026, 12, 1)), null);
  assert.match(matchNextHTML(weeks, berlin(2026, 12, 1)), /keine gemeinsame Freistunde mehr/);
});

test('the markup escapes course names and lists every Freistunde', () => {
  const html = matchHTML([ev(9, '08:45', '12:00')], [ev(9, '13:00', '15:30')], { names: ['<b>A</b>', 'B"'], now: berlin(2026, 11, 9, 7) });
  assert.ok(!html.includes('<b>A</b>'));
  assert.ok(html.includes('&lt;b&gt;A&lt;/b&gt;'));
  assert.ok(html.includes('B&quot;'));
  assert.match(html, /<li><b>12:00 – 13:00<\/b> <span>1 Std\.<\/span><\/li>/);
  assert.match(html, /<li><b>ab 15:30<\/b>/);
  assert.match(html, /role="tab" id="tab-kw46-2026"/, 'week tabs for timetable.js');
  assert.match(html, /1 Std\. gemeinsame Freistunden an 1 Tag/);
  assert.match(matchHTML([], [], { names: ['A', 'B'], now: berlin(2026, 11, 9) }), /keine Termine eingetragen/);
});
