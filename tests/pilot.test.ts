import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPilot, pilotMessage, type PilotRequest } from '../src/data/pilot.ts';

const full: PilotRequest = { name: 'Pat Lee', org: 'Lone Star Dealing Academy', kind: 'school', email: 'pat@example.com', size: '11–25', notes: 'PLO and Hold’em' };

test('a pilot request needs a name, a school, and a real-looking email, in that order', () => {
  assert.equal(checkPilot({ ...full, name: '', org: '' })?.field, 'pName');
  assert.equal(checkPilot({ ...full, org: '' })?.field, 'pOrg');
  assert.equal(checkPilot({ ...full, email: '' })?.field, 'pEmail');
  assert.equal(checkPilot({ ...full, email: 'pat@example' })?.field, 'pEmail');
  assert.equal(checkPilot({ ...full, size: '', notes: '' }), null);
});

test('the dashboard message leads with the school and leaves out what was skipped', () => {
  assert.equal(pilotMessage(full), 'Pilot request: Lone Star Dealing Academy (Dealer school)\nFrom: Pat Lee\nStudents per class: 11–25\n\nPLO and Hold’em');
  assert.equal(pilotMessage({ ...full, kind: 'card_room', size: '', notes: '' }), 'Pilot request: Lone Star Dealing Academy (Card room)\nFrom: Pat Lee');
  assert.ok(pilotMessage({ ...full, notes: 'x'.repeat(5000) }).length <= 2000);
});
