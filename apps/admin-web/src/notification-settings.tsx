import { apiFetch } from './api-fetch.js';
import React from 'react';

type Settings={bookingRemindersEnabled:boolean;bookingReminderMinutes:number;entitlementExpiryEnabled:boolean;entitlementExpiryDays:number;lowBalanceEnabled:boolean;lowBalanceThreshold:number;documentRemindersEnabled:boolean};
const api=import.meta.env?.VITE_API_URL??'http://localhost:3100';
export function NotificationSettings(){
  const [settings,setSettings]=React.useState<Settings|null>(null),[error,setError]=React.useState(''),[saved,setSaved]=React.useState(false),[busy,setBusy]=React.useState(false);
  const load=React.useCallback(async()=>{setError('');try{const r=await apiFetch(`${api}/api/settings/notifications`,{credentials:'include',cache:'no-store'});if(!r.ok)throw new Error();setSettings(await r.json());}catch{setError('No se han podido cargar los avisos.');}},[]);
  React.useEffect(()=>{void load();},[load]);
  const save=async(event:React.FormEvent)=>{event.preventDefault();if(!settings)return;setBusy(true);setSaved(false);setError('');try{const r=await apiFetch(`${api}/api/settings/notifications`,{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(settings)});if(!r.ok)throw new Error();setSaved(true);}catch{setError('No se han podido guardar los cambios.');}finally{setBusy(false);}};
  if(!settings&&!error)return <main className="page-content"><p role="status">Cargando preferencias…</p></main>;
  return <main className="page-content"><div className="page-heading"><p className="eyebrow">OPERACIÓN DEL CENTRO</p><h1>Avisos automáticos</h1><p>Configura recordatorios útiles para clientes, sin reglas complejas.</p></div>{error&&<p className="inline-error" role="alert">{error} <button className="button secondary" onClick={()=>void load()}>Reintentar</button></p>}{settings&&<form className="notification-settings" onSubmit={save}>
    <label><input type="checkbox" checked={settings.bookingRemindersEnabled} onChange={e=>setSettings({...settings,bookingRemindersEnabled:e.target.checked})}/><span><strong>Recordatorio de reserva</strong><small>Enviar un aviso antes de la sesión.</small></span></label>
    <label className="setting-number"><span>Antelación del recordatorio</span><span><input type="number" min={15} max={10080} value={settings.bookingReminderMinutes} onChange={e=>setSettings({...settings,bookingReminderMinutes:Number(e.target.value)})}/> minutos</span></label>
    <label><input type="checkbox" checked={settings.entitlementExpiryEnabled} onChange={e=>setSettings({...settings,entitlementExpiryEnabled:e.target.checked})}/><span><strong>Próxima caducidad</strong><small>Avisar antes de que termine la vigencia del plan.</small></span></label>
    <label className="setting-number"><span>Antelación de caducidad</span><span><input type="number" min={1} max={90} value={settings.entitlementExpiryDays} onChange={e=>setSettings({...settings,entitlementExpiryDays:Number(e.target.value)})}/> días</span></label>
    <label><input type="checkbox" checked={settings.lowBalanceEnabled} onChange={e=>setSettings({...settings,lowBalanceEnabled:e.target.checked})}/><span><strong>Saldo de sesiones bajo</strong><small>Avisar cuando queden pocas sesiones.</small></span></label>
    <label className="setting-number"><span>Avisar al llegar a</span><span><input type="number" min={0} max={100} value={settings.lowBalanceThreshold} onChange={e=>setSettings({...settings,lowBalanceThreshold:Number(e.target.value)})}/> sesiones</span></label>
    <label><input type="checkbox" checked={settings.documentRemindersEnabled} onChange={e=>setSettings({...settings,documentRemindersEnabled:e.target.checked})}/><span><strong>Documentación pendiente</strong><small>Recordar documentos asignados que requieren respuesta.</small></span></label>
    <div className="notification-setting-actions">{saved&&<span role="status">Cambios guardados</span>}<button className="button primary" disabled={busy}>{busy?'Guardando…':'Guardar preferencias'}</button></div>
  </form>}</main>;
}
