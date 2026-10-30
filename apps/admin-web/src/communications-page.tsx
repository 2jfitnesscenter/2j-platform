import { apiFetch } from './api-fetch.js';
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, PageHeader, SearchField, SegmentedControl, icons } from "@2j/ui";
import { Modal } from "./modal.js";
import { clearDeepLink, readDeepLink } from "./deep-link.js";

type InboxItem = {
  clientId: string;
  firstName: string;
  lastName: string;
  conversationId: string;
  lastMessageAt: string | null;
  unreadCount: number;
  pendingDocuments: number;
  pendingConsents: number;
  overdueCheckinDue: string | null;
};
type Message = {
  id: string;
  senderKind: "staff" | "client";
  senderLabel?: string;
  templateId?: string | null;
  body: string;
  createdAt: string;
  readByCenter: boolean | null;
};
type Thread = {
  conversation: { id: string; clientId: string } | null;
  messages: Message[];
  internalNotes: { id: string; body: string; actorLabel?: string; createdAt: string }[];
};
type MessageTemplate = { id:string; name:string; body:string; status:string };
const api = import.meta.env?.VITE_API_URL ?? "http://localhost:3100";
const uuid = () => crypto.randomUUID();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Texto claro para cada rechazo de la API al enviar (nunca el código técnico). */
function sendFailure(status: number, internal: boolean): string {
  if (status === 401) return "Tu sesión ha caducado. Vuelve a entrar.";
  if (status === 403) return internal ? "Tu perfil no puede escribir notas internas." : "Tu perfil puede leer mensajes pero no enviarlos.";
  if (status === 404) return "Este cliente ya no está activo o la plantilla se archivó. Recarga la bandeja.";
  if (status === 400) return "El mensaje está vacío o supera los 5000 caracteres.";
  if (status === 409) return "Este envío ya se había registrado con otro texto. Revisa la conversación y vuelve a escribirlo.";
  return internal ? "No se pudo guardar la nota. Inténtalo de nuevo." : "No se pudo enviar el mensaje. Inténtalo de nuevo; no se duplicará.";
}
export function CommunicationsPage() {
  const [items, setItems] = useState<InboxItem[]>([]),
    [selected, setSelected] = useState<InboxItem | null>(null),
    [thread, setThread] = useState<Thread | null>(null),
    [body, setBody] = useState(""),
    [internal, setInternal] = useState(false),
    [loading, setLoading] = useState(true),
    [threadLoading, setThreadLoading] = useState(false),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [feedback, setFeedback] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  // Una sola clave por borrador: si el envío falla por red y se reintenta, el servidor lo reconoce y no duplica el mensaje.
  const draftKey = useRef<{ clientId: string; body: string; templateId: string; key: string } | null>(null);
  const [deepClientId] = useState(() => { const value = readDeepLink(["clientId"] as const).clientId; return value && UUID_PATTERN.test(value) ? value : null; });
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await apiFetch(`${api}/api/communications/inbox`);
      if (!r.ok)
        throw new Error(
          r.status === 401
            ? "Inicia sesión para consultar la bandeja."
            : r.status === 403
              ? "Tu perfil no tiene permiso para ver comunicaciones."
              : "No se pudo cargar la bandeja.",
        );
      setItems((await r.json()) as InboxItem[]);
      const templateResponse = await apiFetch(`${api}/api/communications/templates`);
      if (templateResponse.ok) setTemplates(((await templateResponse.json()) as MessageTemplate[]).filter((item)=>item.status==='active'));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo cargar la bandeja.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  const loadThread = useCallback(
    async (item: InboxItem) => {
      setSelected(item);
      setThread(null);
      setBody("");
      setInternal(false);
      setSelectedTemplateId("");
      setThreadLoading(true);
      setFeedback("");
      try {
        const r = await apiFetch(
          `${api}/api/clients/${item.clientId}/conversation`,
        );
        if (!r.ok) throw new Error("No se pudo abrir la conversación.");
        const data = (await r.json()) as Thread;
        setThread(data);
        setFeedback("Conversación actualizada.");
        await Promise.all(
          data.messages
            .filter((m) => m.senderKind === "client" && !m.readByCenter)
            .map((m) =>
              apiFetch(`${api}/api/communications/messages/${m.id}/read`, {
                method: "POST",
              }),
            ),
        );
        await load();
      } catch (e) {
        setFeedback(
          e instanceof Error ? e.message : "No se pudo abrir la conversación.",
        );
      } finally {
        setThreadLoading(false);
      }
    },
    [load],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // Enlace desde la ficha del cliente o el Resumen: `#communications?clientId=…` abre directamente su conversación.
  useEffect(() => {
    if (!deepClientId) return;
    clearDeepLink(["clientId"]);
    let cancelled = false;
    void (async () => {
      let name = { firstName: "Cliente", lastName: "seleccionado" };
      try {
        const response = await apiFetch(`${api}/api/clients/${deepClientId}`);
        if (response.ok) { const data = (await response.json()) as { client?: ClientHit }; if (data.client) name = { firstName: data.client.firstName, lastName: data.client.lastName }; }
      } catch { /* sin permiso de ficha: se abre igualmente la conversación */ }
      if (!cancelled) void loadThread({ clientId: deepClientId, ...name, conversationId: "", lastMessageAt: null, unreadCount: 0, pendingDocuments: 0, pendingConsents: 0, overdueCheckinDue: null });
    })();
    return () => { cancelled = true; };
  }, [deepClientId, loadThread]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !body.trim()) return;
    setSending(true);
    setFeedback("");
    try {
      const path = internal
        ? `/api/clients/${selected.clientId}/internal-notes`
        : `/api/clients/${selected.clientId}/messages`;
      const current = draftKey.current;
      const key = !internal && current && current.clientId === selected.clientId && current.body === body && current.templateId === selectedTemplateId ? current.key : uuid();
      if (!internal) draftKey.current = { clientId: selected.clientId, body, templateId: selectedTemplateId, key };
      const response = await apiFetch(`${api}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(internal ? {} : { "idempotency-key": key }),
        },
        body: JSON.stringify({ body, ...(internal || !selectedTemplateId ? {} : { templateId: selectedTemplateId }) }),
      });
      if (!response.ok) throw new Error(sendFailure(response.status, internal));
      draftKey.current = null;
      setBody("");
      await loadThread(selected);
      setFeedback(internal ? "Nota interna guardada." : "Mensaje enviado. El cliente lo verá en su app.");
      await load();
    } catch (e) {
      setFeedback(
        e instanceof Error ? e.message : "No se pudo completar el envío. Inténtalo de nuevo.",
      );
    } finally {
      setSending(false);
    }
  }
  async function markUnread(messageId: string) {
    if (!selected) return;
    try {
      const response = await apiFetch(
        `${api}/api/communications/messages/${messageId}/unread`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("No se pudo marcar el mensaje.");
      setFeedback("Mensaje marcado como no leído.");
      await load();
    } catch (e) {
      setFeedback(
        e instanceof Error ? e.message : "No se pudo marcar el mensaje.",
      );
    }
  }
  const unreadItems = items.filter((entry) => entry.unreadCount > 0);
  const visibleItems = filter === "unread" ? unreadItems : items;
  return (
    <main className="summary comms-page" id="communications" data-2j-design="v2">
      <PageHeader
        title="Mensajes"
        description="Conversaciones del centro con los clientes. Cada mensaje queda en su ficha."
        actions={
          <>
            <Button variant="primary" icon={icons.Plus} onClick={() => setPickerOpen(true)}>Nuevo mensaje</Button>
          </>
        }
      />
      <p className="comms-not-connected"><span className="badge">No conectado</span> Envío por email o WhatsApp: hoy los mensajes se leen en la app del cliente.</p>
      <div className="comms-filter">
        <SegmentedControl
          label="Filtrar mensajes"
          value={filter}
          onChange={(value) => setFilter(value as "all" | "unread")}
          options={[
            { value: "all", label: "Todos" },
            { value: "unread", label: unreadItems.length > 0 ? `Sin leer (${unreadItems.length})` : "Sin leer" },
          ]}
        />
      </div>
        <section
          className="communication-layout"
          aria-label="Bandeja de comunicación"
        >
          <div className="panel communication-inbox">
            <div className="panel-heading">
              <div>
                <h2>Bandeja</h2>
                <p>{visibleItems.length} {visibleItems.length === 1 ? "cliente" : "clientes"} {filter === "unread" ? "con mensajes sin leer" : "con conversación"}</p>
              </div>
              <button className="button secondary" onClick={() => void load()}>
                Actualizar
              </button>
            </div>
            {loading ? (
              <div className="state-panel" role="status">
                <span className="spinner" /> Cargando bandeja…
              </div>
            ) : error ? (
              <div className="state-panel error-panel" role="alert">
                <strong>No se pudo cargar</strong>
                <span>{error}</span>
                <button
                  className="button secondary"
                  onClick={() => void load()}
                >
                  Reintentar
                </button>
              </div>
            ) : visibleItems.length === 0 ? (
              <EmptyState icon={icons.Inbox} title={filter === "unread" ? "No hay mensajes sin leer" : "La bandeja está al día"}>
                {filter === "unread" ? "Todas las conversaciones están leídas." : "Las conversaciones de clientes aparecerán aquí."}
              </EmptyState>
            ) : (
              <div className="inbox-list">
                {visibleItems.map((item) => (
                  <button
                    key={item.clientId}
                    className={`inbox-item ${selected?.clientId === item.clientId ? "selected" : ""}`}
                    onClick={() => void loadThread(item)}
                  >
                    <span className="inbox-avatar" aria-hidden="true">
                      {item.firstName.slice(0, 1)}
                      {item.lastName.slice(0, 1)}
                    </span>
                    <span className="inbox-copy">
                      <strong>
                        {item.firstName} {item.lastName}
                      </strong>
                      <small>
                        {item.unreadCount
                          ? `${item.unreadCount} ${item.unreadCount === 1 ? "mensaje sin leer" : "mensajes sin leer"}`
                          : "Conversación del centro"}
                      </small>
                      <span>
                        {item.pendingDocuments} documentos ·{" "}
                        {item.pendingConsents} consentimientos
                        {item.overdueCheckinDue ? " · Check-in vencido" : ""}
                      </span>
                    </span>
                    {item.unreadCount > 0 && (
                      <span
                        className="inbox-unread"
                        aria-label={`${item.unreadCount} sin leer`}
                      >
                        {item.unreadCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <section
            className="panel communication-thread"
            aria-label="Conversación seleccionada"
          >
            {!selected ? (
              <div className="state-panel">
                <strong>Selecciona una conversación</strong>
                <span>
                  El contexto queda disponible para el equipo autorizado.
                </span>
              </div>
            ) : (
              <>
                <div className="panel-heading thread-heading">
                  <div>
                    <div className="eyebrow">CONVERSACIÓN DEL CENTRO</div>
                    <h2>
                      {selected.firstName} {selected.lastName}
                    </h2>
                    <p>Visible para el equipo con permisos de comunicación.</p>
                  </div>
                  <a className="button secondary" href="#clients">
                    Ficha 360
                  </a>
                </div>
                {threadLoading ? (
                  <div className="state-panel" role="status">
                    Cargando conversación…
                  </div>
                ) : feedback && !thread ? (
                  <div className="state-panel error-panel" role="alert">
                    <span>{feedback}</span>
                    <button
                      className="button secondary"
                      onClick={() => void loadThread(selected)}
                    >
                      Reintentar
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="message-list" aria-live="off" aria-label="Historial de mensajes y notas">
                      {thread?.messages.map((m) => (
                        <article
                          key={m.id}
                          className={`message-bubble ${m.senderKind}`}
                        >
                          <strong>{m.senderKind === "client" ? `${selected.firstName} ${selected.lastName}` : m.senderLabel || "Personal del centro"}</strong>
                          <p>{m.body}</p>
                          <time>
                            {new Intl.DateTimeFormat("es-ES", {
                              dateStyle: "short",
                              timeStyle: "short",
                              timeZone: "Atlantic/Canary",
                            }).format(new Date(m.createdAt))}
                          </time>
                          {m.senderKind === "client" && m.readByCenter && (
                            <button
                              className="button secondary"
                              onClick={() => void markUnread(m.id)}
                            >
                              Marcar como no leído
                            </button>
                          )}
                        </article>
                      ))}
                      {thread?.internalNotes.map((n) => (
                        <article key={n.id} className="message-bubble internal">
                          <strong>{n.actorLabel || "Personal del centro"} · Nota interna · solo equipo</strong>
                          <p>{n.body}</p>
                          <time>
                            {new Intl.DateTimeFormat("es-ES", {
                              dateStyle: "short",
                              timeStyle: "short",
                              timeZone: "Atlantic/Canary",
                            }).format(new Date(n.createdAt))}
                          </time>
                        </article>
                      ))}
                    </div>
                    <form className={`message-composer ${internal ? "internal-mode" : ""}`} onSubmit={send} aria-busy={sending}>
                      {internal && <div className="internal-mode-banner"><strong>Nota interna · Solo staff</strong><span>No se enviará al cliente.</span></div>}
                      <label className="internal-toggle">
                        <input
                          type="checkbox"
                          disabled={sending}
                          checked={internal}
                          onChange={(e) => setInternal(e.target.checked)}
                        />{" "}
                        Nota interna del centro
                      </label>
                      {!internal && templates.length>0 && <label className="template-picker">Usar plantilla<select aria-label="Usar plantilla" value={selectedTemplateId} disabled={sending} onChange={event=>{const id=event.target.value;setSelectedTemplateId(id);const selectedTemplate=templates.find(item=>item.id===id);if(selectedTemplate)setBody(selectedTemplate.body);}}><option value="">Elegir plantilla…</option>{templates.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
                      <label className="sr-only" htmlFor="message-body">
                        {internal ? "Nota interna" : "Mensaje para el cliente"}
                      </label>
                      <textarea
                        id="message-body"
                        disabled={sending}
                        maxLength={5000}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder={
                          internal
                            ? "Escribe una nota visible solo para el equipo…"
                            : "Escribe un mensaje para el cliente…"
                        }
                      />
                      {feedback && (
                        <p className="inline-feedback" role="status" aria-live="polite">
                          {feedback}
                        </p>
                      )}
                      <button
                        className="button primary"
                        disabled={sending || !body.trim()}
                      >
                        {sending
                          ? internal ? "Guardando…" : "Enviando…"
                          : internal
                            ? "Guardar nota interna"
                            : "Enviar mensaje"}
                      </button>
                    </form>
                  </>
                )}
              </>
            )}
          </section>
        </section>
      {pickerOpen && <NewMessagePicker onClose={() => setPickerOpen(false)} onPick={(client) => { setPickerOpen(false); setFilter("all"); void loadThread({ clientId: client.id, firstName: client.firstName, lastName: client.lastName, conversationId: "", lastMessageAt: null, unreadCount: 0, pendingDocuments: 0, pendingConsents: 0, overdueCheckinDue: null }); }} />}
    </main>
  );
}

type ClientHit = { id: string; firstName: string; lastName: string };

/** Elige a quién escribir: busca en los clientes (la API aplica sus permisos) y abre su conversación. */
function NewMessagePicker({ onClose, onPick }: { onClose: () => void; onPick: (client: ClientHit) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error" | "denied">("idle");
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setHits([]); setState("idle"); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch(`${api}/api/clients?q=${encodeURIComponent(term)}&limit=8`, { signal: controller.signal });
        if (response.status === 403 || response.status === 401) { setState("denied"); return; }
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { items: ClientHit[] };
        setHits(data.items);
        setState("idle");
      } catch (caught) { if ((caught as Error).name !== "AbortError") setState("error"); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  return (
    <Modal titleId="new-message-title" title="¿A quién escribes?" description="Busca al cliente por nombre y abre su conversación." onClose={onClose}>
      <SearchField label="Buscar cliente" placeholder="Nombre o apellidos…" value={query} onChange={setQuery} />
      <div aria-live="polite">
        {state === "loading" && <p className="comms-picker-note" role="status">Buscando…</p>}
        {state === "denied" && <p className="comms-picker-note" role="alert">Tu perfil no puede buscar clientes.</p>}
        {state === "error" && <p className="comms-picker-note" role="alert">No se pudo buscar. Inténtalo de nuevo.</p>}
        {state === "idle" && query.trim().length >= 2 && hits.length === 0 && <p className="comms-picker-note">Sin resultados para esa búsqueda.</p>}
      </div>
      {hits.length > 0 && (
        <ul className="comms-picker-list" aria-label="Clientes encontrados">
          {hits.map((client) => (
            <li key={client.id}>
              <button type="button" className="comms-picker-item" onClick={() => onPick(client)}>
                <span className="inbox-avatar" aria-hidden="true">{client.firstName.slice(0, 1)}{client.lastName.slice(0, 1)}</span>
                <strong>{client.firstName} {client.lastName}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
