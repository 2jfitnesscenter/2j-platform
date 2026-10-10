import React from "react";

type Page =
  | "home"
  | "agenda"
  | "clients"
  | "more"
  | "session"
  | "client"
  | "messages"
  | "conversation"
  | "timeclock"
  | "team";
type Caps = {
  calendar: boolean;
  clients: boolean;
  communications: boolean;
  billing: boolean;
  staff: boolean;
  reservationManage?: boolean;
  attendanceManage?: boolean;
  entitlementsRead?: boolean;
  entitlementsManage?: boolean;
  paymentsManage?: boolean;
  communicationSend?: boolean;
  documentsRead?: boolean;
  timeclockSelf?: boolean;
  capacityOverride?: boolean;
};
type Session = {
  id: string;
  serviceName: string;
  areaName: string;
  professionalName: string | null;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  occupiedCount: number;
  overbookCount: number;
  waitlistCount: number;
  status: string;
  isIndividual: boolean;
};
type Client = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  status: string;
};
const dateKey = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Atlantic/Canary",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const startOfWeek = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!, 12));
  return shift(key, -((date.getUTCDay() + 6) % 7));
};
const shift = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.UTC(y!, m! - 1, d! + n, 12)));
};
const time = (s: string) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Atlantic/Canary",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(s));
export async function staffApi<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const base = import.meta.env?.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";
  const response = await fetch(`${base}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `http_${response.status}`);
  return body as T;
}
function operationKey(operation: string) {
  const keyName = `2j:staff:${operation}:idempotency`;
  let key = sessionStorage.getItem(keyName);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(keyName, key);
  }
  return { key, clear: () => sessionStorage.removeItem(keyName) };
}
export function visibleDestinations(caps: Caps) {
  return [
    { id: "home", label: "Inicio", show: true },
    { id: "agenda", label: "Agenda", show: caps.calendar },
    { id: "clients", label: "Clientes", show: caps.clients },
    { id: "more", label: "Más", show: true },
  ].filter((x) => x.show);
}
const errorCopy = (e: unknown) =>
  e instanceof Error && e.message === "authentication_required"
    ? "Tu sesión ha terminado. Vuelve a iniciar sesión con tu cuenta de 2J."
    : e instanceof Error && e.message === "permission_denied"
      ? "Tu cuenta no tiene permiso para esta acción."
      : "No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.";
export function StaffApp() {
  const [page, setPage] = React.useState<Page>("home"),
    [caps, setCaps] = React.useState<Caps | null>(null),
    [loading, setLoading] = React.useState(true),
    [error, setError] = React.useState(""),
    [sessions, setSessions] = React.useState<Session[]>([]),
    [selectedDate, setSelectedDate] = React.useState(() => dateKey(new Date())),
    [selected, setSelected] = React.useState<Session | null>(null),
    [attendees, setAttendees] = React.useState<{
      reservations: any[];
      waitlist: any[];
    }>({ reservations: [], waitlist: [] }),
    [clients, setClients] = React.useState<Client[]>([]),
    [query, setQuery] = React.useState(""),
    [client, setClient] = React.useState<Client | null>(null),
    [clientPlans, setClientPlans] = React.useState<any[]>([]),
    [clock, setClock] = React.useState<any>(null),
    [inbox, setInbox] = React.useState<any[]>([]),
    [toast, setToast] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [actions, setActions] = React.useState<any>({}),
    [bookingClient, setBookingClient] = React.useState<Client | null>(null),
    [eligibility, setEligibility] = React.useState<any>(null),
    [entitlement, setEntitlement] = React.useState(""),
    [planCatalog, setPlanCatalog] = React.useState<any[]>([]),
    [planId, setPlanId] = React.useState(""),
    [showPlanSale, setShowPlanSale] = React.useState(false);
  const loadWeek = React.useCallback(async () => {
    const from = startOfWeek(selectedDate);
    const r = await staffApi<{ sessions: Session[]; capabilities: any }>(
      `/api/calendar/week?weekStart=${from}`,
    );
    setSessions(r.sessions);
    setActions((x: any) => ({ ...x, ...r.capabilities }));
  }, [selectedDate]);
  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const c = await staffApi<Caps>("/api/session/capabilities");
      setCaps(c);
      const jobs: Promise<unknown>[] = [];
      if (c.calendar) jobs.push(loadWeek());
      if (c.communications)
        jobs.push(staffApi<any[]>("/api/communications/inbox").then(setInbox));
      if (c.timeclockSelf)
        jobs.push(staffApi("/api/timeclock/self").then(setClock));
      else setClock(null);
      await Promise.all(jobs);
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setLoading(false);
    }
  }, [loadWeek]);
  React.useEffect(() => {
    void load();
  }, [load]);
  const openSession = async (s: Session) => {
    setSelected(s);
    setPage("session");
    setToast("");
    try {
      const a = await staffApi<typeof attendees>(
        `/api/calendar/sessions/${s.id}/attendees`,
      );
      setAttendees(a);
    } catch (e) {
      setToast(errorCopy(e));
    }
  };
  const search = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setClients([]);
      return;
    }
    try {
      const r = await staffApi<{ items: Client[]; capabilities: any }>(
        `/api/clients?q=${encodeURIComponent(q.trim())}&limit=20`,
      );
      setClients(r.items);
      setActions((x: any) => ({ ...x, ...r.capabilities }));
    } catch (e) {
      setToast(errorCopy(e));
    }
  };
  const openClient = async (c: Client) => {
    setClient(c);
    setPage("client");
    setClientPlans([]);
    try {
      const detail = await staffApi<any>(`/api/clients/${c.id}`);
      setClient(detail.client ?? c);
      if (detail.capabilities?.readEntitlements) {
        const plans = await staffApi<any>(`/api/clients/${c.id}/plans`);
        setClientPlans(
          Array.isArray(plans)
            ? plans
            : (plans.assignments ?? plans.plans ?? []),
        );
      }
      if (
        detail.capabilities?.assignPlans &&
        detail.capabilities?.readEntitlements
      ) {
        const catalog = await staffApi<any[]>("/api/plans/assignable");
        setPlanCatalog(catalog);
        setPlanId(catalog[0]?.id ?? "");
      }
      setActions((x: any) => ({
        ...x,
        ...detail.capabilities,
        clientDocuments:
          detail.summary?.documents?.access === "available"
            ? detail.summary.documents.data
            : null,
      }));
    } catch (e) {
      setToast(errorCopy(e));
    }
  };
  const assignPlan = async () => {
    if (!client || !planId) return;
    const plan = planCatalog.find((p) => p.id === planId);
    if (!plan) return;
    setBusy(true);
    const startsOn = dateKey(new Date());
    const op = operationKey(`client-plan:${client.id}:${planId}:${startsOn}`);
    try {
      await staffApi(`/api/clients/${client.id}/plans`, {
        method: "POST",
        headers: { "idempotency-key": op.key },
        body: JSON.stringify({
          planId,
          startsOn,
          endsOn: null,
          dueOn: startsOn,
          amountCents: plan.basePriceCents,
        }),
      });
      op.clear();
      setShowPlanSale(false);
      await openClient(client);
      setToast("Cuota asignada. El cargo queda pendiente.");
    } catch (e) {
      setToast(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  const attendance = async (
    id: string,
    status: "attended" | "no_show" | "reserved",
  ) => {
    setBusy(true);
    try {
      await staffApi(`/api/calendar/reservations/${id}/attendance`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (selected) await openSession(selected);
      setToast(
        status === "reserved"
          ? "Asistencia deshecha"
          : "Asistencia actualizada.",
      );
    } catch (e) {
      setToast(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  const checkClient = async (c: Client) => {
    setBookingClient(c);
    setEligibility(null);
    setEntitlement("");
    if (!selected) return;
    try {
      const result = await staffApi<any>(
        `/api/calendar/sessions/${selected.id}/booking-eligibility?clientId=${c.id}`,
      );
      setEligibility(result);
      if (result.availableAlternatives?.length === 1)
        setEntitlement(result.availableAlternatives[0].assignmentId);
    } catch (e) {
      setToast(errorCopy(e));
    }
  };
  const addClient = async (wait = false) => {
    if (!selected || !bookingClient) return;
    setBusy(true);
    const op = operationKey(
      `${wait ? "waitlist" : "reservation"}:${selected.id}:${bookingClient.id}:${entitlement || "auto"}`,
    );
    try {
      await staffApi(
        `/api/calendar/sessions/${selected.id}/${wait ? "waitlist" : "reservations"}`,
        {
          method: "POST",
          headers: { "idempotency-key": op.key },
          body: JSON.stringify({
            clientId: bookingClient.id,
            ...(entitlement ? { entitlementAssignmentId: entitlement } : {}),
          }),
        },
      );
      op.clear();
      setBookingClient(null);
      setEligibility(null);
      setQuery("");
      setClients([]);
      await openSession(selected);
      setToast(
        wait ? "Cliente añadido a la lista de espera." : "Reserva creada.",
      );
    } catch (e) {
      setToast(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  const timeclock = async () => {
    setBusy(true);
    try {
      await staffApi(
        `/api/timeclock/${clock?.openShift ? "clock-out" : "clock-in"}`,
        { method: "POST", body: JSON.stringify({ origin: "staff_app" }) },
      );
      setClock(await staffApi("/api/timeclock/self"));
      setToast(clock?.openShift ? "Salida registrada." : "Entrada registrada.");
    } catch (e) {
      setToast(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  const nav = (id: string) => {
    setPage(id as Page);
    setToast("");
  };
  if (loading)
    return (
      <div className="state" role="status">
        <span className="spinner" />
        Preparando tu espacio de trabajo…
      </div>
    );
  if (error)
    return (
      <main className="state error" role="alert">
        <span className="brand-mark">2J</span>
        <h1>No se puede abrir 2J Staff</h1>
        <p>{error}</p>
        <button className="primary" onClick={() => void load()}>
          Intentar de nuevo
        </button>
      </main>
    );
  if (!caps) return null;
  const todaySessions = sessions.filter(
    (s) =>
      dateKey(new Date(s.startsAt)) === selectedDate &&
      s.status === "scheduled",
  );
  const destination = visibleDestinations(caps);
  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand"
          href="#inicio"
          onClick={(e) => {
            e.preventDefault();
            nav("home");
          }}
        >
          <span className="brand-mark">2J</span>
          <span>
            <b>2J Staff</b>
            <small>Operativa del centro</small>
          </span>
        </a>
        <button
          className="avatar"
          aria-label="Perfil del equipo"
          onClick={() => nav("more")}
        >
          •
        </button>
      </header>
      <main className="main" id="main-content">
        {toast && (
          <p className="toast" role="status">
            {toast}
          </p>
        )}
        {page === "home" && (
          <>
            <section className="hero">
              <p className="eyebrow">
                {new Intl.DateTimeFormat("es-ES", {
                  timeZone: "Atlantic/Canary",
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                }).format(new Date())}
              </p>
              <h1>Tu centro, hoy.</h1>
              <p>Lo importante de la jornada, en un vistazo.</p>
            </section>
            <div className="heading">
              <h2>Próxima sesión</h2>
              <button className="link" onClick={() => nav("agenda")}>
                Ver agenda
              </button>
            </div>
            {todaySessions.length ? (
              <SessionCard
                session={todaySessions[0]!}
                onOpen={() => void openSession(todaySessions[0]!)}
              />
            ) : (
              <div className="empty">
                <b>Sin sesiones programadas</b>
                <span>La agenda de hoy está despejada.</span>
              </div>
            )}
            <div className="heading">
              <h2>Hoy</h2>
              <span className="subtle">{todaySessions.length} sesiones</span>
            </div>
            <div className="stack">
              {todaySessions.slice(0, 5).map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  onOpen={() => void openSession(s)}
                />
              ))}
            </div>
            <div className="quick-grid">
              {caps.calendar && (
                <button onClick={() => nav("agenda")}>
                  ◷<span>Abrir agenda</span>
                </button>
              )}
              {caps.clients && (
                <button onClick={() => nav("clients")}>
                  ⌕<span>Buscar cliente</span>
                </button>
              )}
              {clock && (
                <button onClick={() => nav("timeclock")}>
                  ◉<span>{clock.openShift ? "Fichaje abierto" : "Fichar"}</span>
                </button>
              )}
            </div>
          </>
        )}
        {page === "agenda" && (
          <>
            <div className="page-title">
              <p className="eyebrow">OPERATIVA</p>
              <h1>Agenda</h1>
              <p>Sesiones del centro, hora local de Canarias.</p>
            </div>
            <div className="date-row">
              <button
                aria-label="Día anterior"
                onClick={() => setSelectedDate((v) => shift(v, -1))}
              >
                ‹
              </button>
              <input
                aria-label="Elegir fecha"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
              <button
                aria-label="Día siguiente"
                onClick={() => setSelectedDate((v) => shift(v, 1))}
              >
                ›
              </button>
              <button
                className="link"
                onClick={() => setSelectedDate(dateKey(new Date()))}
              >
                Hoy
              </button>
            </div>
            <div className="stack">
              {todaySessions.length ? (
                todaySessions.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onOpen={() => void openSession(s)}
                  />
                ))
              ) : (
                <div className="empty">
                  <b>No hay sesiones este día</b>
                  <span>Prueba otra fecha de la agenda.</span>
                </div>
              )}
            </div>
          </>
        )}
        {page === "session" && selected && (
          <>
            <button className="back" onClick={() => nav("agenda")}>
              ← Agenda
            </button>
            <section className="session-hero">
              <p className="eyebrow">
                {time(selected.startsAt)} · {selected.durationMinutes} min
              </p>
              <h1>{selected.serviceName}</h1>
              <p>
                {selected.areaName} · {selected.professionalName ?? "Equipo 2J"}
                {selected.isIndividual ? " · Cita individual" : ""}
              </p>
              <div className="capacity">
                <b>
                  {selected.occupiedCount}/{selected.capacity}
                </b>
                <span>plazas ocupadas</span>
                <strong>{selected.waitlistCount} en espera</strong>
              </div>
            </section>
            {actions.manage && (
              <section className="add-booking">
                <h2>Añadir cliente</h2>
                <label className="search">
                  <span>⌕</span>
                  <input
                    value={query}
                    onInput={(e) => {
                      const value = e.currentTarget.value;
                      setQuery(value);
                      if (value.trim().length >= 2) void search(value);
                      else setClients([]);
                    }}
                    placeholder="Buscar cliente"
                    aria-label="Buscar cliente para reservar"
                  />
                </label>
                {clients.map((c) => (
                  <button
                    className="client-row"
                    key={c.id}
                    onClick={() => void checkClient(c)}
                  >
                    <span className="person-avatar">
                      {c.firstName[0]}
                      {c.lastName[0]}
                    </span>
                    <span>
                      <b>
                        {c.firstName} {c.lastName}
                      </b>
                      <small>{c.phone ?? "Cliente activo"}</small>
                    </span>
                  </button>
                ))}
                {bookingClient && (
                  <div className="eligibility">
                    <b>
                      {eligibility?.allowed
                        ? "Puede reservar"
                        : eligibility?.waitlistAllowed
                          ? "Puede entrar en espera"
                          : "Comprobando elegibilidad"}
                    </b>
                    {eligibility?.blockingReasons?.map((reason: string) => (
                      <small key={reason}>{eligibilityText(reason)}</small>
                    ))}
                    {eligibility?.availableAlternatives?.length > 1 && (
                      <label>
                        Cuota
                        <select
                          value={entitlement}
                          onChange={(e) => setEntitlement(e.target.value)}
                        >
                          <option value="">Seleccionar cuota</option>
                          {eligibility.availableAlternatives.map(
                            (item: any) => (
                              <option
                                key={item.assignmentId}
                                value={item.assignmentId}
                              >
                                {item.planName ?? "Cuota disponible"}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    )}
                    {eligibility?.allowed && (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          Boolean(
                            eligibility.availableAlternatives?.length > 1 &&
                            !entitlement,
                          )
                        }
                        onClick={() => void addClient(false)}
                      >
                        Confirmar reserva
                      </button>
                    )}
                    {eligibility?.waitlistAllowed && (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          (!entitlement &&
                            eligibility.availableAlternatives?.length > 1)
                        }
                        onClick={() => void addClient(true)}
                      >
                        Añadir a lista de espera
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
            <div className="heading">
              <h2>Reservas</h2>
              <span className="subtle">{attendees.reservations.length}</span>
            </div>
            <div className="stack">
              {attendees.reservations.map((r: any) => (
                <div className="person" key={r.id}>
                  <span className="person-avatar">
                    {r.firstName?.[0]}
                    {r.lastName?.[0]}
                  </span>
                  <div>
                    <b>
                      {r.firstName} {r.lastName}
                    </b>
                    <small>{statusLabel(r.status)}</small>
                  </div>
                  {actions.attendance &&
                    ["reserved", "attended", "no_show"].includes(r.status) && (
                      <div className="person-actions">
                        <button
                          disabled={busy}
                          aria-label={`Marcar asistió: ${r.firstName}`}
                          onClick={() => void attendance(r.id, "attended")}
                        >
                          {r.status === "attended" ? "✓" : "Asistió"}
                        </button>
                        <button
                          disabled={busy}
                          aria-label={`Marcar no-show: ${r.firstName}`}
                          onClick={() => void attendance(r.id, "no_show")}
                        >
                          {r.status === "no_show" ? "✓" : "No-show"}
                        </button>
                      </div>
                    )}
                </div>
              ))}
            </div>
            <div className="heading">
              <h2>Lista de espera</h2>
              <span className="subtle">{attendees.waitlist.length}</span>
            </div>
            <div className="stack">
              {attendees.waitlist.map((w: any, i: number) => (
                <div className="person" key={w.id}>
                  <span className="wait-rank">{i + 1}</span>
                  <div>
                    <b>
                      {w.firstName} {w.lastName}
                    </b>
                    <small>{statusLabel(w.status)}</small>
                  </div>
                </div>
              ))}
              {!attendees.waitlist.length && (
                <div className="empty compact">Sin personas en espera.</div>
              )}
            </div>
          </>
        )}
        {page === "clients" && (
          <>
            <div className="page-title">
              <p className="eyebrow">RELACIÓN CON CLIENTES</p>
              <h1>Clientes</h1>
              <p>Busca por nombre o teléfono. Solo se cargan resultados.</p>
            </div>
            <label className="search">
              <span>⌕</span>
              <input
                value={query}
                onChange={(e) => void search(e.target.value)}
                placeholder="Buscar cliente"
                aria-label="Buscar cliente"
                autoComplete="off"
              />
            </label>
            <div className="stack">
              {clients.map((c) => (
                <button
                  className="client-row"
                  key={c.id}
                  onClick={() => void openClient(c)}
                >
                  <span className="person-avatar">
                    {c.firstName[0]}
                    {c.lastName[0]}
                  </span>
                  <span>
                    <b>
                      {c.firstName} {c.lastName}
                    </b>
                    <small>{c.phone ?? c.email ?? "Cliente activo"}</small>
                  </span>
                  <span className="arrow">›</span>
                </button>
              ))}
            </div>
          </>
        )}
        {page === "client" && client && (
          <>
            <button className="back" onClick={() => nav("clients")}>
              ← Clientes
            </button>
            <section className="client-hero">
              <span className="profile-avatar">
                {client.firstName[0]}
                {client.lastName[0]}
              </span>
              <div>
                <p className="eyebrow">CLIENTE 360</p>
                <h1>
                  {client.firstName} {client.lastName}
                </h1>
                <p>
                  {client.phone ?? client.email ?? "Sin contacto registrado"}
                </p>
              </div>
            </section>
            {actions.clientDocuments && (
              <div className="note">
                Documentación: {actions.clientDocuments.pendingForms ?? 0}{" "}
                formularios y {actions.clientDocuments.pendingConsents ?? 0}{" "}
                consentimientos pendientes.
              </div>
            )}
            <div className="heading">
              <h2>Cuotas</h2>
              {actions.assignPlans && (
                <button
                  className="link"
                  onClick={() => setShowPlanSale((v) => !v)}
                >
                  {showPlanSale ? "Cerrar" : "Añadir cuota"}
                </button>
              )}
            </div>
            {actions.entitlementsRead ? (
              clientPlans.length ? (
                <div className="stack">
                  {clientPlans.map((p: any) => (
                    <article className="plan" key={p.id}>
                      <b>{p.planName ?? p.name ?? "Plan"}</b>
                      <span>
                        {p.derivedStatus === "active"
                          ? "Activa"
                          : p.derivedStatus === "paused"
                            ? "En pausa"
                            : p.derivedStatus === "scheduled"
                              ? "Programada"
                              : p.derivedStatus === "expired"
                                ? "Vencida"
                                : (p.derivedStatus ?? p.status)}
                      </span>
                      <small>
                        {p.startsOn ?? ""}
                        {p.endsOn ? ` · hasta ${p.endsOn}` : ""}
                      </small>
                      {p.rights?.map((r: any, i: number) => (
                        <small key={i}>
                          {r.rightType === "sessions_quota"
                            ? `${r.balance ?? "—"} de ${r.quantity ?? "—"} sesiones restantes`
                            : r.rightType === "service_access"
                              ? `Acceso${r.serviceName ? ` · ${r.serviceName}` : ""}`
                              : (r.serviceName ?? "Derecho del plan")}
                        </small>
                      ))}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <b>No hay cuotas asignadas</b>
                  <span>No se encontraron asignaciones para este cliente.</span>
                </div>
              )
            ) : (
              <div className="empty">
                <b>Detalle de cuota restringido</b>
                <span>Tu perfil no tiene permiso de lectura de derechos.</span>
              </div>
            )}
            {showPlanSale && actions.assignPlans && (
              <section className="plan-sale">
                <h3>Asignar cuota</h3>
                <p>
                  Se aplicará el precio definido en el plan. El cargo quedará
                  pendiente.
                </p>
                <label>
                  Plan
                  <select
                    aria-label="Plan para asignar"
                    value={planId}
                    onChange={(e) => setPlanId(e.target.value)}
                  >
                    <option value="">Seleccionar plan</option>
                    {planCatalog.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ·{" "}
                        {new Intl.NumberFormat("es-ES", {
                          style: "currency",
                          currency: "EUR",
                        }).format(p.basePriceCents / 100)}
                      </option>
                    ))}
                  </select>
                </label>
                {planId && (
                  <button
                    className="primary wide"
                    disabled={busy}
                    onClick={() => void assignPlan()}
                  >
                    {busy ? "Guardando…" : "Asignar y dejar pendiente"}
                  </button>
                )}
              </section>
            )}
            <div className="quick-grid">
              {client.phone && (
                <a href={`tel:${client.phone}`}>
                  ☎<span>Llamar</span>
                </a>
              )}
              {caps.communications && (
                <button onClick={() => nav("messages")}>
                  ✉<span>Mensajes</span>
                </button>
              )}
              {actions.paymentsManage && (
                <span className="note">Cobro autorizado desde Economía.</span>
              )}
            </div>
          </>
        )}
        {page === "messages" && (
          <>
            <div className="page-title">
              <p className="eyebrow">COMUNICACIÓN</p>
              <h1>Mensajes</h1>
              <p>Bandeja del centro.</p>
            </div>
            <div className="stack">
              {inbox.map((row: any) => (
                <button
                  className="client-row"
                  key={row.clientId}
                  onClick={() => {
                    setClient({
                      id: row.clientId,
                      firstName: row.firstName,
                      lastName: row.lastName,
                      phone: null,
                      email: null,
                      status: "active",
                    });
                    setPage("conversation");
                  }}
                >
                  <span className="person-avatar">
                    {row.firstName?.[0]}
                    {row.lastName?.[0]}
                  </span>
                  <span>
                    <b>
                      {row.firstName} {row.lastName}
                    </b>
                    <small>
                      {row.unreadCount
                        ? `${row.unreadCount} sin leer`
                        : "Abrir conversación"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {page === "conversation" && client && (
          <Conversation client={client} onBack={() => nav("messages")} />
        )}
        {page === "timeclock" && (
          <>
            <div className="page-title">
              <p className="eyebrow">MI JORNADA</p>
              <h1>Fichaje</h1>
              <p>Hora local · Atlantic/Canary</p>
            </div>
            <section className="clock-card">
              <span className="clock-symbol">◷</span>
              <p>
                {clock?.openShift
                  ? "Jornada en curso"
                  : "No hay una jornada abierta"}
              </p>
              {clock?.lastEvent && (
                <small>
                  {clock.lastEvent.eventType === "clock_in"
                    ? "Entrada"
                    : "Salida"}{" "}
                  · {time(clock.lastEvent.occurredAt)}
                </small>
              )}
              <button
                className="primary wide"
                disabled={busy || !clock}
                onClick={() => void timeclock()}
              >
                {busy
                  ? "Guardando…"
                  : clock?.openShift
                    ? "Registrar salida"
                    : "Registrar entrada"}
              </button>
            </section>
            {clock?.workedSecondsToday > 0 && (
              <p className="subtle center">
                Hoy: {Math.floor(clock.workedSecondsToday / 3600)} h{" "}
                {Math.floor((clock.workedSecondsToday % 3600) / 60)} min
              </p>
            )}
          </>
        )}
        {page === "team" && (
          <>
            <div className="page-title">
              <p className="eyebrow">EQUIPO</p>
              <h1>Equipo operativo</h1>
              <p>Resumen disponible para tu cuenta.</p>
            </div>
            <TeamSummary />
          </>
        )}
        {page === "more" && (
          <>
            <div className="page-title">
              <p className="eyebrow">HERRAMIENTAS</p>
              <h1>Más</h1>
              <p>Accesos operativos según tus permisos.</p>
            </div>
            <div className="more-list">
              {caps.communications && (
                <button onClick={() => nav("messages")}>
                  ✉{" "}
                  <span>
                    <b>Mensajes</b>
                    <small>Bandeja del centro</small>
                  </span>
                  <i>›</i>
                </button>
              )}
              {clock && (
                <button onClick={() => nav("timeclock")}>
                  ◷{" "}
                  <span>
                    <b>Fichaje</b>
                    <small>
                      {clock.openShift ? "Jornada abierta" : "Tu jornada"}
                    </small>
                  </span>
                  <i>›</i>
                </button>
              )}
              {caps.staff && (
                <button onClick={() => nav("team")}>
                  ◉{" "}
                  <span>
                    <b>Equipo</b>
                    <small>Estado operativo</small>
                  </span>
                  <i>›</i>
                </button>
              )}
              {caps.billing && (
                <div className="note">
                  Economía disponible desde la aplicación de gestión. Los cobros
                  se mantienen en su flujo autorizado.
                </div>
              )}
              <button onClick={() => void load()}>
                ↻{" "}
                <span>
                  <b>Actualizar</b>
                  <small>Volver a cargar información</small>
                </span>
              </button>
            </div>
          </>
        )}
      </main>
      <nav className="bottom-nav" aria-label="Navegación principal">
        {destination.map((d) => (
          <button
            className={page === d.id ? "active" : ""}
            key={d.id}
            onClick={() => nav(d.id)}
            aria-current={page === d.id ? "page" : undefined}
          >
            <span aria-hidden="true">
              {{ home: "⌂", agenda: "◷", clients: "♙", more: "•••" }[d.id]}
            </span>
            <small>{d.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
function statusLabel(s: string) {
  return (
    (
      {
        reserved: "Reservado",
        attended: "Asistió",
        no_show: "No se presentó",
        waiting: "En espera",
        cancelled: "Cancelada",
        cancelled_late: "Cancelación tardía",
      } as Record<string, string>
    )[s] ?? "Estado actualizado"
  );
}
function eligibilityText(s: string) {
  return (
    (
      {
        session_full: "La sesión ha alcanzado su capacidad.",
        no_active_entitlement: "No hay un derecho activo para este servicio.",
        no_entitlement: "No hay un derecho activo para este servicio.",
        entitlement_required: "Selecciona una cuota disponible.",
        entitlement_unavailable: "No hay saldo disponible para esta sesión.",
        entitlement_exhausted: "La cuota no tiene sesiones restantes.",
        debt_restriction: "Hay un saldo pendiente que impide reservar.",
        required_document_missing: "Falta documentación requerida.",
        session_cancelled: "La sesión está cancelada.",
        client_inactive: "El cliente no está activo.",
        session_started: "La sesión ya ha comenzado.",
        service_archived: "El servicio ya no está disponible.",
        area_archived: "El área ya no está disponible.",
        booking_conflict: "El cliente tiene otra actividad a esa hora.",
        duplicate_booking: "El cliente ya está en esta sesión.",
      } as Record<string, string>
    )[s] ?? "La elegibilidad requiere revisión."
  );
}
function SessionCard({
  session: s,
  onOpen,
}: {
  session: Session;
  onOpen: () => void;
}) {
  return (
    <button className="session-card" onClick={onOpen}>
      <span className="session-time">
        {time(s.startsAt)}
        <small>{s.durationMinutes} min</small>
      </span>
      <span className="session-info">
        <b>
          {s.serviceName}
          {s.isIndividual ? " · Cita individual" : ""}
        </b>
        <small>{s.professionalName ?? s.areaName}</small>
        <span className="session-meta">
          {s.occupiedCount}/{s.capacity} plazas
          {s.waitlistCount ? ` · ${s.waitlistCount} en espera` : ""}
          {s.overbookCount ? ` · Sobrecupo +${s.overbookCount}` : ""}
        </span>
      </span>
      <span className="arrow">›</span>
    </button>
  );
}
function Conversation({
  client,
  onBack,
}: {
  client: Client;
  onBack: () => void;
}) {
  const [data, setData] = React.useState<any>(null),
    [body, setBody] = React.useState(""),
    [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [canSend, setCanSend] = React.useState(false);
  React.useEffect(() => {
    void staffApi<any>(`/api/clients/${client.id}`)
      .then((r) => setCanSend(Boolean(r.capabilities?.communicationSend)))
      .catch(() => {});
    void staffApi<any>(`/api/clients/${client.id}/conversation`)
      .then(setData)
      .catch((e) => setError(errorCopy(e)));
  }, [client.id]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !canSend) return;
    setBusy(true);
    try {
      await staffApi(`/api/clients/${client.id}/messages`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ body: body.trim() }),
      });
      setBody("");
      setData(await staffApi(`/api/clients/${client.id}/conversation`));
    } catch (e) {
      setError(errorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="back" onClick={onBack}>
        ← Mensajes
      </button>
      <h1>Conversación con {client.firstName}</h1>
      {error && (
        <p role="alert" className="note">
          {error}
        </p>
      )}
      <div className="message-list">
        {(data?.messages ?? []).map((m: any) => (
          <p
            className={`bubble ${m.senderKind === "center" ? "out" : ""}`}
            key={m.id}
          >
            {m.body}
            <small>{m.senderLabel}</small>
          </p>
        ))}
      </div>
      {canSend ? (
        <form className="send-form" onSubmit={(e) => void send(e)}>
          <textarea
            aria-label="Escribir mensaje"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
          />
          <button className="primary" disabled={busy || !body.trim()}>
            Enviar
          </button>
        </form>
      ) : (
        <p className="note">
          Tu perfil puede consultar mensajes, pero no enviarlos.
        </p>
      )}
    </>
  );
}
function TeamSummary() {
  const [data, setData] = React.useState<any>(null);
  React.useEffect(() => {
    void staffApi<any>("/api/staff/dashboard")
      .then(setData)
      .catch(() => setData(null));
  }, []);
  return data ? (
    <>
      <div className="metric">
        <b>{data.workingNow?.length ?? 0}</b>
        <span>personas trabajando ahora</span>
      </div>
      <div className="metric">
        <b>{data.todayScheduled}</b>
        <span>turnos programados hoy</span>
      </div>
      <div className="metric">
        <b>{data.timeclockIncidents}</b>
        <span>incidencias de fichaje</span>
      </div>
    </>
  ) : (
    <div className="empty">
      Resumen de equipo no disponible para este perfil.
    </div>
  );
}
