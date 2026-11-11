import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingTime } from '../lib/meeting-time.mjs';

test('time and zone use the selected zone rather than the device zone', () => {
  const time = meetingTime('2026-11-14T02:00:00Z', '2026-11-14T02:30:00Z', 'Asia/Yakutsk');
  assert.equal(time.startLabel, '11:00 AM');
  assert.equal(time.endLabel, '11:30 AM');
  assert.equal(time.zoneLabel, 'Asia/Yakutsk · UTC+09:00');
});
test('half-hour offsets and UTC are unambiguous', () => {
  assert.equal(meetingTime('2026-11-14T02:00:00Z', '2026-11-14T02:30:00Z', 'Asia/Kolkata').zoneLabel, 'Asia/Kolkata · UTC+05:30');
  assert.equal(meetingTime('2026-11-14T02:00:00Z', '2026-11-14T02:30:00Z', 'UTC').zoneLabel, 'UTC · UTC+00:00');
});
test('offset follows the meeting date in summer and winter', () => {
  assert.equal(meetingTime('2026-07-14T02:00:00Z', '2026-07-14T02:30:00Z', 'Europe/Berlin').zoneLabel, 'Europe/Berlin · UTC+02:00');
  assert.equal(meetingTime('2026-11-14T02:00:00Z', '2026-11-14T02:30:00Z', 'Europe/Berlin').zoneLabel, 'Europe/Berlin · UTC+01:00');
});
test('meetings spanning a clock change show both offsets', () => {
  const time = meetingTime('2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', 'America/New_York');
  assert.equal(time.startLabel, '1:30 AM');
  assert.equal(time.endLabel, '1:30 AM');
  assert.equal(time.zoneLabel, 'America/New_York · UTC-04:00 → UTC-05:00');
});
test('meetings crossing local midnight include the end date', () => {
  const time = meetingTime('2026-12-31T14:30:00Z', '2026-12-31T15:30:00Z', 'Asia/Yakutsk');
  assert.equal(time.startLabel, '11:30 PM');
  assert.equal(time.endLabel, 'Jan 1, 2027, 12:30 AM');
});
