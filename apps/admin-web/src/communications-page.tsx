import { useCallback, useEffect, useState } from "react";

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
const api = import.meta.env?.VITE_API_URL ?? "http://127.0.0.1:3100";
const uuid = () => crypto.randomUUID();
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
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${api}/api/communications/inbox`);
      if (!r.ok)
        throw new Error(
          r.status === 401
            ? "Inicia sesión para consultar la bandeja."
            : r.status === 403
              ? "Tu perfil no tiene permiso para ver comunicaciones."
              : "No se pudo cargar la bandeja.",
        );
      setItems((await r.json()) as InboxItem[]);
      const templateResponse = await fetch(`${api}/api/communications/templates`);
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
        const r = await fetch(
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
              fetch(`${api}/api/communications/messages/${m.id}/read`, {
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
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !body.trim()) return;
    setSending(true);
    setFeedback("");
    try {
      const path = internal
        ? `/api/clients/${selected.clientId}/internal-notes`
        : `/api/clients/${selected.clientId}/messages`;
      const response = await fetch(`${api}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(internal ? {} : { "idempotency-key": uuid() }),
        },
        body: JSON.stringify({ body, ...(internal || !selectedTemplateId ? {} : { templateId: selectedTemplateId }) }),
      });
      if (!response.ok) throw new Error("No se pudo guardar el mensaje.");
      setBody("");
      await loadThread(selected);
      setFeedback(internal ? "Nota interna guardada." : "Mensaje enviado.");
      await load();
    } catch (e) {
      setFeedback(
        e instanceof Error ? e.message : "No se pudo completar el envío.",
      );
    } finally {
      setSending(false);
    }
  }
  async function markUnread(messageId: string) {
    if (!selected) return;
    try {
      const response = await fetch(
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
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#services">
          <span className="brand-mark">2J</span>
          <span className="brand-copy">
            FITNESS CENTER<small>OPERACIONES</small>
          </span>
        </a>
        <div className="nav-label">GESTIÓN</div>
        <nav aria-label="Gestión">
          <a className="nav-item" href="#services">
            Servicios y planes
          </a>
          <a className="nav-item" href="#clients">
            Clientes
          </a>
          <a className="nav-item" href="#calendar">
            Calendario
          </a>
          <a className="nav-item" href="#economics">
            Pagos
          </a>
          <a className="nav-item" href="#staff">
            Equipo
          </a>
          <a
            className="nav-item active"
            href="#communications"
            aria-current="page"
          >
            Comunicación
          </a>
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">
            Gestión <span aria-hidden="true">›</span> Comunicación
          </div>
          <div className="local-pill">
            <span className="status-dot" /> Entorno local
          </div>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">SEGUIMIENTO DEL CENTRO</div>
            <h1>Comunicación</h1>
            <p>
              Conversaciones compartidas por el equipo y documentación
              pendiente.
            </p>
          </div>
        </section>
        <section
          className="communication-layout"
          aria-label="Bandeja de comunicación"
        >
          <div className="panel communication-inbox">
            <div className="panel-heading">
              <div>
                <h2>Bandeja</h2>
                <p>{items.length} clientes con conversación</p>
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
            ) : items.length === 0 ? (
              <div className="state-panel">
                <strong>La bandeja está al día</strong>
                <span>Las conversaciones de clientes aparecerán aquí.</span>
              </div>
            ) : (
              <div className="inbox-list">
                {items.map((item) => (
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
                          ? `${item.unreadCount} mensajes sin leer`
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
      </main>
    </div>
  );
}
