import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  cleanup,
  fireEvent,
  render,
  within,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { StaffApp, visibleDestinations, staffAppTestHelpers } from "../src/staff-app.tsx";

const caps = (overrides = {}) => ({
  calendar: true,
  clients: true,
  communications: true,
  billing: false,
  staff: false,
  reservationManage: true,
  attendanceManage: true,
  entitlementsRead: true,
  entitlementsManage: false,
  paymentsManage: false,
  communicationSend: true,
  documentsRead: true,
  timeclockSelf: false,
  ...overrides,
});
function setupDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost/" },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: dom.window.sessionStorage,
    configurable: true,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}
function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

test("capability menu omits destinations the server does not grant", () => {
  assert.deepEqual(
    visibleDestinations(caps({ calendar: false, clients: false })).map(
      (x) => x.id,
    ),
    ["home", "more", "notifications"],
  );
  assert.deepEqual(
    visibleDestinations(caps({ calendar: true, clients: true })).map(
      (x) => x.id,
    ),
    ["home", "agenda", "clients", "more", "notifications"],
  );
});

test("staff notification targets are allowlisted and capability checked", () => {
  const resolve = staffAppTestHelpers.resolveStaffNotificationTarget;
  const allowed = caps();
  assert.deepEqual(resolve('/agenda', allowed), {page:'agenda'});
  assert.deepEqual(resolve('/sessions/11111111-1111-4111-8111-111111111111', allowed), {page:'agenda',sessionId:'11111111-1111-4111-8111-111111111111'});
  assert.deepEqual(resolve('/clients/22222222-2222-4222-8222-222222222222', allowed), {page:'clients',clientId:'22222222-2222-4222-8222-222222222222'});
  assert.deepEqual(resolve('/messages', allowed), {page:'messages'});
  assert.equal(resolve('/team', allowed), null);
  assert.equal(resolve('/economics', allowed), null);
  assert.equal(resolve('/agenda', caps({calendar:false})), null);
  assert.equal(resolve('/clients/22222222-2222-4222-8222-222222222222', caps({clients:false})), null);
  assert.equal(resolve('/messages', caps({communications:false})), null);
  assert.equal(resolve('https://example.test/', allowed), null);
  assert.equal(resolve('javascript:alert(1)', allowed), null);
  assert.equal(resolve('//evil.test', allowed), null);
  assert.equal(resolve('/unknown', allowed), null);
});

test("staff app loads a permission-aware home and hides unavailable links", async () => {
  const dom = setupDom();
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes("/api/session/capabilities")
      ? response(
          caps({
            clients: false,
            calendar: false,
            communications: false,
            staff: false,
            timeclockSelf: false,
          }),
        )
      : response({});
  try {
    render(React.createElement(StaffApp));
    const q = within(document.body);
    await q.findByRole("heading", { name: "Tu centro, hoy." });
    assert.equal(q.queryByRole("button", { name: /Clientes/ }), null);
    assert.equal(q.queryByRole("button", { name: /Agenda/ }), null);
    assert.ok(q.getByRole("button", { name: /Inicio/ }));
  } finally {
    cleanup();
    globalThis.fetch = original;
    dom.window.close();
  }
});

test("authentication failure stops the app and offers retry without exposing operational data", async () => {
  const dom = setupDom();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response({ error: "authentication_required" }, 401);
  };
  try {
    render(React.createElement(StaffApp));
    const q = within(document.body);
    await q.findByRole("heading", { name: "No se puede abrir 2J Staff" });
    assert.equal(q.queryByRole("navigation"), null);
    assert.equal(calls, 1);
  } finally {
    cleanup();
    globalThis.fetch = original;
    dom.window.close();
  }
});

test("staff notification inbox is available without exposing unrelated operational data", async () => {
  const dom=setupDom(),original=globalThis.fetch;
  let itemRead=false;
  globalThis.fetch=async(url,init={})=>String(url).includes('/api/session/capabilities')?response(caps({calendar:false,clients:false,communications:true,staff:false,timeclockSelf:false})):String(url)==='/api/communications/inbox'?response([]):String(url)==='/api/staff/notifications/unread-count'?response({count:itemRead?0:1}):String(url)==='/api/staff/notifications'?response({items:[{id:'11111111-1111-4111-8111-111111111111',title:'Cambio de cobertura',body:'Hay una actualización sobre una cobertura de equipo.',deeplink:'/messages',createdAt:'2026-10-10T10:00:00.000Z',readAt:itemRead?new Date().toISOString():null}],nextBefore:null,nextBeforeId:null}):String(url).endsWith('/read')&&init.method==='PATCH'?(itemRead=true,response({id:'11111111-1111-4111-8111-111111111111',readAt:new Date().toISOString()})):response({});
  try{render(React.createElement(StaffApp));const q=within(document.body);await q.findByRole('button',{name:/Avisos/});fireEvent.click(q.getByRole('button',{name:/Avisos/}));assert.ok(await q.findByRole('heading',{name:'Notificaciones'}));assert.ok(q.getByText('Cambio de cobertura'));assert.equal(q.queryByText(/datos de clientes|saldo|importe/i),null);fireEvent.click(q.getByRole('button',{name:'Abrir aviso: Cambio de cobertura'}));assert.ok(await q.findByRole('heading',{name:'Mensajes'}));assert.equal(itemRead,true);assert.ok(await q.findByRole('button',{name:'Avisos'}));}finally{cleanup();globalThis.fetch=original;dom.window.close();}
});

test("agenda presents sessions in local time and links into session detail", async () => {
  const dom = setupDom();
  const original = globalThis.fetch;
  const session = {
    id: "s1",
    serviceName: "Fuerza",
    areaName: "Sala 1",
    professionalName: "Alex",
    startsAt: "2026-10-10T09:00:00.000Z",
    durationMinutes: 50,
    capacity: 10,
    occupiedCount: 8,
    overbookCount: 0,
    waitlistCount: 2,
    status: "scheduled",
    isIndividual: false,
  };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/session/capabilities"))
      return response(caps({ staff: false, timeclockSelf: false }));
    if (u.includes("/api/calendar/week"))
      return response({
        sessions: [session],
        capabilities: { manage: true, attendance: true },
      });
    if (u.includes("/attendees"))
      return response({
        reservations: [
          { id: "r1", firstName: "Eva", lastName: "Pérez", status: "reserved" },
        ],
        waitlist: [],
      });
    return response({});
  };
  try {
    render(React.createElement(StaffApp));
    const q = within(document.body);
    await q.findByRole("heading", { name: "Tu centro, hoy." });
    fireEvent.click(q.getByRole("button", { name: /Agenda/ }));
    await q.findByText("Fuerza");
    fireEvent.click(q.getByRole("button", { name: /Fuerza/ }));
    await q.findByRole("heading", { name: "Reservas" });
    assert.ok(q.getByText("Eva Pérez"));
    assert.ok(q.getByText(/2 en espera/));
  } finally {
    cleanup();
    globalThis.fetch = original;
    dom.window.close();
  }
});

test("staff booking preview gates the reserve action and reuses the established reservation API", async () => {
  const dom = setupDom();
  const original = globalThis.fetch;
  const session = {
    id: "s1",
    serviceName: "Fuerza",
    areaName: "Sala 1",
    professionalName: "Alex",
    startsAt: "2026-10-10T09:00:00.000Z",
    durationMinutes: 50,
    capacity: 10,
    occupiedCount: 8,
    overbookCount: 0,
    waitlistCount: 0,
    status: "scheduled",
    isIndividual: false,
  };
  const client = {
    id: "c1",
    firstName: "Eva",
    lastName: "Pérez",
    phone: "600000000",
    email: null,
    status: "active",
  };
  let reservation;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/api/session/capabilities"))
      return response(caps({ staff: false, timeclockSelf: false }));
    if (u.includes("/api/calendar/week"))
      return response({
        sessions: [session],
        capabilities: { manage: true, attendance: true },
      });
    if (u.includes("/attendees"))
      return response({ reservations: [], waitlist: [] });
    if (u.includes("/api/clients?"))
      return response({ items: [client], capabilities: {} });
    if (u.includes("booking-eligibility"))
      return response({
        allowed: true,
        decision: "allowed",
        blockingReasons: [],
        availableAlternatives: [],
        waitlistAllowed: false,
      });
    if (u.endsWith("/reservations") && init.method === "POST") {
      reservation = {
        url: u,
        headers: init.headers,
        body: JSON.parse(String(init.body)),
      };
      return response({ id: "r1" }, 201);
    }
    return response({});
  };
  try {
    render(React.createElement(StaffApp));
    const q = within(document.body);
    await q.findByRole("heading", { name: "Tu centro, hoy." });
    fireEvent.click(q.getByRole("button", { name: /Agenda/ }));
    await q.findByText("Fuerza");
    fireEvent.click(q.getByRole("button", { name: /Fuerza/ }));
    await q.findByRole("heading", { name: "Añadir cliente" });
    fireEvent.input(
      q.getByRole("textbox", { name: "Buscar cliente para reservar" }),
      { target: { value: "Eva" } },
    );
    fireEvent.click(await q.findByRole("button", { name: /Eva Pérez/ }));
    await q.findByText("Puede reservar");
    fireEvent.click(q.getByRole("button", { name: "Confirmar reserva" }));
    await waitFor(() => assert.ok(reservation));
    assert.equal(reservation.body.clientId, "c1");
    assert.match(reservation.headers["idempotency-key"], /^[0-9a-f-]{36}$/i);
    assert.equal(reservation.url, "/api/calendar/sessions/s1/reservations");
  } finally {
    cleanup();
    globalThis.fetch = original;
    dom.window.close();
  }
});
