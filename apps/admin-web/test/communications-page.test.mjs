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
            body: "Gracias.",
            createdAt: "2026-10-01T10:05:00Z",
            readByCenter: true,
          },
        ],
        internalNotes: [
          {
            id: "n-1",
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
  assert.equal(
    screen.getByLabelText("Nota interna").getAttribute("maxLength"),
    "5000",
  );
});
