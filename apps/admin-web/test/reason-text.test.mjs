import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REASONS, networkReason, reasonText } from '../src/reason-text.ts';

test('every known reason names a cause and tells the person what to do, and none is the generic text', () => {
  for (const [code, text] of Object.entries(REASONS)) {
    assert.ok(text.length > 40, `${code} is too short to hold a cause and an action`);
    assert.ok(!/No se pudo completar/.test(text), `${code} is generic`);
    assert.match(text, /[.!]$/, `${code} must end as a sentence`);
  }
  // Los códigos que el API devuelve hoy en fichaje y caja tienen texto propio.
  for (const code of ['shift_already_open', 'no_open_shift', 'staff_account_unlinked', 'cash_register_must_be_closed_or_handed_over', 'clock_in_required', 'cash_custodian_not_clocked_in', 'cash_custodian_required', 'cash_outflow_approval_pending', 'cash_session_previous_day_requires_owner_resolution', 'cash_already_closed', 'handover_recipient_not_clocked_in', 'internal_error']) assert.ok(REASONS[code], code);
});

test('a code without text still gets a cause by status, the attempted action and the code to quote; a server message wins over a status guess but not over a known code', () => {
  assert.match(reasonText('brand_new', 409, null, { action: 'cerrar la caja' }), /al cerrar la caja.*código: brand_new/);
  assert.match(reasonText(undefined, 503, null, { action: 'fichar la salida' }), /El servidor falló al fichar la salida.*código HTTP 503/);
  assert.match(reasonText(undefined, 404, null, { action: 'abrir la caja' }), /No se encontró/);
  assert.match(reasonText(undefined, 401), /sesión ha caducado/);
  assert.match(reasonText(undefined, 403), /no tiene permiso/);
  assert.equal(reasonText('brand_new', 409, 'Mensaje propio del servidor.'), 'Mensaje propio del servidor.');
  assert.equal(reasonText('no_open_shift', 409, 'Mensaje del servidor'), REASONS.no_open_shift, 'a known code keeps the reviewed text');
  assert.match(networkReason('cerrar la caja'), /No hay conexión con el servidor para cerrar la caja/);
});
