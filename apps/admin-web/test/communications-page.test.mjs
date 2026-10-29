import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5173/#communications",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
const { cleanup, fireEvent, render, screen, waitFor } = await import(
  "@testing-library/react"
);
const { CommunicationsPage } = await import("../src/communications-page.tsx");
afterEach(() => {
  cleanup();
  globalThis.fetch = undefined;
});
after(() => dom.window.close());
const item = {
  clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  firstName: "Ana",
  lastName: "Prueba",
  conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  lastMessageAt: "2026-10-01T10:00:00Z",
  unreadCount: 2,
  pendingDocuments: 1,
  pendingConsents: 1,
  nextCheckinDue: null,
};
const response = (body, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

test("inbox shows unread and document state, separates internal notes, sends center messages accessibly", async () => {
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/api/communications/inbox"))
      return response([item]);
    if (String(url).endsWith("/api/communications/templates")) return response([]);
    if (String(url).endsWith(`/api/clients/${item.clientId}/conversation`))
      return response({
        conversation: { id: item.conversationId, clientId: item.clientId },
        messages: [
          {
            id: "m-1",
            senderKind: "client",
            body: "¿A qué hora?",
            createdAt: "2026-10-01T10:00:00Z",
            readByCenter: false,
          },
          {
            id: "m-2",
            senderKind: "client",
            senderLabel: "Personal del centro",
            body: "Gracias.",
            createdAt: "2026-10-01T10:05:00Z",
            readByCenter: true,
          },
        ],
        internalNotes: [
          {
            id: "n-1",
            actorLabel: "Laura",
            body: "Solo el equipo",
            createdAt: "2026-10-01T10:01:00Z",
          },
        ],
      });
    if (
      String(url).endsWith("/api/communications/messages/m-1/read") ||
      String(url).endsWith("/api/communications/messages/m-2/unread")
    )
      return response({ read: true });
    if (String(url).endsWith(`/api/clients/${item.clientId}/messages`))
      return response({ id: "m-3" }, 201);
    throw new Error(`Unexpected request ${url}`);
  };
  render(React.createElement(CommunicationsPage));
  fireEvent.click(await screen.findByRole("button", { name: /Ana Prueba/ }));
  await screen.findByText("Solo el equipo");
  assert.ok(screen.getByText("Laura · Nota interna · solo equipo"));
  assert.equal(screen.getByLabelText("2 sin leer").textContent, "2");
  fireEvent.click(screen.getByRole("button", { name: "Marcar como no leído" }));
  await screen.findByText("Mensaje marcado como no leído.");
  assert.ok(
    requests.some((r) =>
      r.url.endsWith("/api/communications/messages/m-2/unread"),
    ),
  );
  fireEvent.change(screen.getByLabelText("Mensaje para el cliente"), {
    target: { value: "Te esperamos a las 9." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
  await screen.findByText("Mensaje enviado.");
  await waitFor(() =>
    assert.ok(
      requests.some((r) =>
        r.url.endsWith(`/api/clients/${item.clientId}/messages`),
      ),
    ),
  );
  fireEvent.click(screen.getByLabelText("Nota interna del centro"));
  assert.ok(screen.getByText("Nota interna · Solo staff"));
  assert.equal(screen.getByRole("button", { name: "Guardar nota interna" }).disabled, true);
  assert.equal(
    screen.getByLabelText("Nota interna").getAttribute("maxLength"),
    "5000",
  );
});

test("active message template fills editable composer and keeps template reference on send", async()=>{
  let sent;
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);
    if(path.endsWith('/api/communications/inbox'))return response([item]);
    if(path.endsWith('/api/communications/templates'))return response([{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Bienvenida',body:'Hola, {{nombre}}',status:'active'}]);
    if(path.endsWith(`/api/clients/${item.clientId}/conversation`))return response({conversation:{id:item.conversationId,clientId:item.clientId},messages:[],internalNotes:[]});
    if(path.endsWith(`/api/clients/${item.clientId}/messages`)){sent=JSON.parse(options.body);return response({id:'m-new'},201);}
    return response({});
  };
  render(React.createElement(CommunicationsPage));
  fireEvent.click(await screen.findByRole('button',{name:/Ana Prueba/}));
  const selector=await screen.findByLabelText('Usar plantilla');
  fireEvent.change(selector,{target:{value:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}});
  const composer=screen.getByLabelText('Mensaje para el cliente');
  assert.equal(composer.value,'Hola, {{nombre}}');
  fireEvent.change(composer,{target:{value:'Hola, Ana'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));
  await screen.findByText('Mensaje enviado.');
  assert.deepEqual(sent,{body:'Hola, Ana',templateId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});
});

test("sending state disables composer controls and announces completion",async()=>{
  let finish;
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);
    if(path.endsWith('/api/communications/inbox')||path.endsWith('/api/communications/templates'))return response(path.endsWith('/templates')?[]:[item]);
    if(path.endsWith(`/api/clients/${item.clientId}/conversation`))return response({conversation:{id:item.conversationId,clientId:item.clientId},messages:[],internalNotes:[]});
    if(path.endsWith(`/api/clients/${item.clientId}/messages`))return new Promise(resolve=>{finish=()=>resolve(response({id:'m-new'},201));});
    return response({});
  };
  render(React.createElement(CommunicationsPage));
  fireEvent.click(await screen.findByRole('button',{name:/Ana Prueba/}));
  const composer=await screen.findByLabelText('Mensaje para el cliente');
  fireEvent.change(composer,{target:{value:'Mensaje de prueba'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));
  assert.equal((await screen.findByRole('button',{name:'Enviando…'})).disabled,true);
  assert.equal(composer.disabled,true);
  finish();
  await screen.findByText('Mensaje enviado.');
});

test("Mensajes filters the inbox to unread conversations and labels what is not connected", async () => {
  const read = { ...item, clientId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", firstName: "Bea", lastName: "Leída", unreadCount: 0 };
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.endsWith("/api/communications/inbox")) return response([item, read]);
    if (path.endsWith("/api/communications/templates")) return response([]);
    return response({});
  };
  render(React.createElement(CommunicationsPage));
  await screen.findByRole("button", { name: /Bea Leída/ });
  assert.ok(screen.getByRole("heading", { name: "Mensajes" }));
  assert.ok(screen.getByText("No conectado"));
  fireEvent.click(screen.getByRole("button", { name: "Sin leer (1)" }));
  await waitFor(() => assert.equal(screen.queryByRole("button", { name: /Bea Leída/ }), null));
  assert.ok(screen.getByRole("button", { name: /Ana Prueba/ }));
  fireEvent.click(screen.getByRole("button", { name: "Todos" }));
  assert.ok(await screen.findByRole("button", { name: /Bea Leída/ }));
});

test("Nuevo mensaje searches clients and sends the first message with an idempotency key", async () => {
  const requests = [];
  const target = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", firstName: "Carla", lastName: "Nueva" };
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    requests.push({ path, options });
    if (path.endsWith("/api/communications/inbox")) return response([]);
    if (path.endsWith("/api/communications/templates")) return response([]);
    if (path.includes("/api/clients?q=")) return response({ items: [target] });
    if (path.endsWith(`/api/clients/${target.id}/conversation`)) return response({ conversation: null, messages: [], internalNotes: [] });
    if (path.endsWith(`/api/clients/${target.id}/messages`)) return response({ id: "m-new" }, 201);
    return response({});
  };
  render(React.createElement(CommunicationsPage));
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo mensaje" }));
  fireEvent.change(await screen.findByLabelText("Buscar cliente"), { target: { value: "Carl" } });
  fireEvent.click(await screen.findByRole("button", { name: /Carla Nueva/ }));
  fireEvent.change(await screen.findByLabelText("Mensaje para el cliente"), { target: { value: "Bienvenida a 2J." } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
  await screen.findByText("Mensaje enviado.");
  const sent = requests.find((r) => r.path.endsWith(`/api/clients/${target.id}/messages`));
  assert.equal(JSON.parse(sent.options.body).body, "Bienvenida a 2J.");
  assert.match(sent.options.headers["Idempotency-Key"] ?? sent.options.headers["idempotency-key"], /^[0-9a-f-]{36}$/);
});

test("Mensajes filters unread conversations and starts a new message by searching a client", async () => {
  const read = { ...item, clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", firstName: "Luis", lastName: "Leído", unreadCount: 0 };
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith("/api/communications/inbox")) return response([item, read]);
    if (String(url).endsWith("/api/communications/templates")) return response([]);
    if (String(url).includes("/api/clients?q=")) return response({ items: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", firstName: "Marta", lastName: "Nueva" }] });
    if (String(url).endsWith("/conversation")) return response({ conversation: null, messages: [], internalNotes: [] });
    return response({});
  };
  const { within } = await import("@testing-library/react");
  render(React.createElement(CommunicationsPage));
  assert.ok(await screen.findByRole("heading", { level: 1, name: "Mensajes" }));
  await screen.findByText("Luis Leído");
  fireEvent.click(screen.getByRole("button", { name: "Sin leer (1)" }));
  assert.equal(screen.queryByText("Luis Leído"), null, "read conversations leave the unread view");
  assert.ok(screen.getByText("Ana Prueba"));
  fireEvent.click(screen.getByRole("button", { name: "Nuevo mensaje" }));
  const dialog = await screen.findByRole("dialog", { name: "¿A quién escribes?" });
  fireEvent.change(within(dialog).getByLabelText("Buscar cliente"), { target: { value: "Marta" } });
  fireEvent.click(await within(dialog).findByRole("button", { name: /Marta Nueva/ }, { timeout: 1500 }));
  await waitFor(() => assert.ok(requests.some((url) => url.endsWith("/api/clients/dddddddd-dddd-4ddd-8ddd-dddddddddddd/conversation"))));
  assert.ok(await screen.findByLabelText("Mensaje para el cliente"));
});
