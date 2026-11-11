'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3, Globe2, Plus, RefreshCw, X } from 'lucide-react';
import EventSettingsFields, { type EventSettings } from './event-settings-fields';
import { eventSettings } from '../lib/event-settings.mjs';
import { meetingTime } from '../lib/meeting-time.mjs';
export type EventType = { id: number; title: string; duration: number; description: string; scheduleId?: number | null; formats?: { id: string; label: string; input: string | null }[] };
type Schedule = { id: number; name: string; timeZone: string; isDefault: boolean; availability: { days: string[]; startTime: string; endTime: string }[]; overrides: { date: string; startTime: string; endTime: string }[] };
type Booking = { format?: string; reference: string; title: string; start: string; end: string; status: string; eventTypeId: number; participants: string[]; cancellationReason: string; rescheduledTo: boolean };
type Mode = 'events' | 'availability' | 'bookings';
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const pendingKey = 'meetingschedule-pending-management';
async function api(path: string, options: RequestInit = {}) {
  const r = await fetch('/api/public/' + path, { credentials: 'same-origin', ...options });
  const data = await r.json() as any;
  if (!r.ok) throw Object.assign(new Error(data.error || 'The request failed.'), { status: r.status, uncertain: data.uncertain });
  return data;
}
function savePending(id: string | null) { try { if (id) sessionStorage.setItem(pendingKey, id); else sessionStorage.removeItem(pendingKey); } catch {} }
export default function WorkspaceManagement({ mode, events, zone, zones, onZone, onUpdate, onBook }: { mode: Mode; events: EventType[]; zone: string; zones: string[]; onZone: (zone: string) => void; onUpdate: () => Promise<void>; onBook: (id: number) => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]), [bookings, setBookings] = useState<Booking[]>([]);
  const [status, setStatus] = useState('upcoming'), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null), lock = useRef(false), generation = useRef(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState(false), [editingId, setEditingId] = useState<number | null>(null);
  const [formatChoices, setFormatChoices] = useState<{ id: string; label: string; available: boolean }[]>([]), [eventFormat, setEventFormat] = useState(''), [formatDetail, setFormatDetail] = useState('');
  const [settings, setSettings] = useState<EventSettings>(eventSettings() as EventSettings), [settingsChanges, setSettingsChanges] = useState<Partial<EventSettings>>({}), [loadingEvent, setLoadingEvent] = useState(false), editorGeneration = useRef(0);
  const [title, setTitle] = useState(''), [slug, setSlug] = useState(''), [duration, setDuration] = useState(30), [description, setDescription] = useState(''), [scheduleId, setScheduleId] = useState('');
  const [scheduleName, setScheduleName] = useState(''), [scheduleZone, setScheduleZone] = useState(zone), [weekdays, setWeekdays] = useState(days.slice(0, 5)), [startTime, setStartTime] = useState('09:00'), [endTime, setEndTime] = useState('17:00');
  const [overrides, setOverrides] = useState<{ date: string; startTime: string; endTime: string }[]>([]);
  const [action, setAction] = useState<{ booking: Booking; kind: 'cancel' | 'reschedule' } | null>(null), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [newDate, setNewDate] = useState(''), [slots, setSlots] = useState<string[]>([]), [selected, setSelected] = useState(''), [finding, setFinding] = useState(false), [searched, setSearched] = useState(false), slotGeneration = useRef(0);
  async function refresh(append = false, pageCursor: string | null = null) {
    const gen = ++generation.current; setLoading(true); setError('');
    try {
      if (mode === 'bookings') {
        const query = new URLSearchParams({ status }); if (pageCursor) query.set('cursor', pageCursor);
        const data = await api('bookings?' + query);
        if (gen === generation.current) { setBookings(old => append ? [...new Map([...old, ...data.bookings].map(b => [b.reference, b])).values()] : data.bookings); setCursor(data.nextCursor); }
      } else {
        const [data, formats] = await Promise.all([api('schedules'), mode === 'events' ? api('formats') : Promise.resolve(null)]);
        if (gen === generation.current) { if (formats) setFormatChoices(formats.formats); setSchedules(data.schedules); setScheduleId(old => old || String(data.schedules.find((s: Schedule) => s.isDefault)?.id || data.schedules[0]?.id || '')); }
      }
    } catch (e: any) { if (gen === generation.current) setError(e.message); }
    finally { if (gen === generation.current) setLoading(false); }
  }
  useEffect(() => { editorGeneration.current++; setLoadingEvent(false); setBookings([]); setCursor(null); setAction(null); setEditor(false); setMessage(''); void refresh(); return () => { generation.current++; }; }, [mode, status]);
  useEffect(() => { try { setPendingId(sessionStorage.getItem(pendingKey)); } catch {} }, []);
  useEffect(() => { slotGeneration.current++; setSlots([]); setSelected(''); setSearched(false); setFinding(false); }, [newDate, zone, action]);
  async function mutate(path: string, payload: unknown, method = 'POST') {
    if (lock.current || pendingId) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    const id = crypto.randomUUID(); savePending(id);
    try {
      await api(path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify(payload) });
      savePending(null); setEditor(false); setAction(null); setMessage('Saved. The workspace is up to date.');
      await Promise.all([onUpdate(), refresh()]).catch(e => setError('Saved, but refresh failed: ' + e.message));
    } catch (e: any) {
      if (e.uncertain || !e.status || e.status >= 500) { setPendingId(id); setError('The result is not confirmed. Check the change status and refresh the list before making another change.'); }
      else { savePending(null); setError(e.message); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function checkChange() {
    if (!pendingId) return; setBusy(true); setError('');
    try { await api('receipt?' + new URLSearchParams({ requestId: pendingId })); savePending(null); setPendingId(null); setEditor(false); setAction(null); setMessage('Change confirmed.'); await Promise.all([onUpdate(), refresh()]).catch(e => setError('Saved, but refresh failed: ' + e.message)); }
    catch (e: any) { setError(e.message); if (e.uncertain === false) { savePending(null); setPendingId(null); } }
    finally { setBusy(false); }
  }
  async function findSlots() {
    if (!action) return; const gen = ++slotGeneration.current; setFinding(true); setError(''); setSelected(''); setSlots([]); setSearched(false);
    try { const data = await api('slots?' + new URLSearchParams({ eventTypeId: String(action.booking.eventTypeId), date: newDate, timeZone: zone })); if (gen === slotGeneration.current) { setSlots(data.slots); setSearched(true); } }
    catch (e: any) { if (gen === slotGeneration.current) setError(e.message); }
    finally { if (gen === slotGeneration.current) setFinding(false); }
  }
  useEffect(() => { if (editor || action) { editorRef.current?.scrollIntoView({ block: 'start' }); editorRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }); } }, [editor, action]);
  const disabled = busy || loadingEvent || !!pendingId;
  const timeLabel = (s: string) => new Intl.DateTimeFormat('en', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(s));
  async function edit(event?: EventType) {
    const gen = ++editorGeneration.current; setError(''); setEditor(false); setLoadingEvent(true);
    try {
      const current = event ? (await api('event-types/' + event.id)).event : null;
      if (gen !== editorGeneration.current) return;
      setEventFormat(''); setFormatDetail(''); setEditingId(current?.id || null); setTitle(current?.title || ''); setSlug(current?.slug || ''); setDuration(current?.duration || 30); setDescription(current?.description || '');
      setSettings((current?.settings || eventSettings()) as EventSettings); setSettingsChanges({});
      setScheduleId(String(current?.scheduleId || schedules.find(s => s.isDefault)?.id || schedules[0]?.id || '')); setEditor(true);
    } catch (e: any) { if (gen === editorGeneration.current) setError(e.message); }
    finally { if (gen === editorGeneration.current) setLoadingEvent(false); }
  }
  return <section className="workspace-panel" aria-label={mode === 'events' ? 'Event types' : mode === 'availability' ? 'Availability schedules' : 'Bookings'}>
    <div className="workspace-heading"><div><p className="eyebrow">SHARED WORKSPACE</p><h2>{mode === 'events' ? 'Events for every conversation' : mode === 'availability' ? 'Make time for what matters' : 'Your meeting reservations'}</h2><p className="muted">{mode === 'events' ? 'Create a meeting type, choose its duration, and connect an availability schedule.' : mode === 'availability' ? 'Set offered hours in a specific time zone, then assign the schedule to an event.' : 'See upcoming meetings, past reservations, and cancellations from Cal.com.'}</p></div><div className="workspace-actions"><button className="button" disabled={loading || busy} onClick={() => { void refresh(); void onUpdate().catch(e => setError(e.message)); }}><RefreshCw size={18} className={loading ? 'spinning' : ''} />Refresh</button>{mode !== 'bookings' && <button className="button primary" disabled={disabled} onClick={() => mode === 'events' ? edit() : setEditor(true)}><Plus size={18} />{mode === 'events' ? 'New event' : 'New schedule'}</button>}</div></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {message && <div className="workspace-notice" role="status">{message}</div>}
    {pendingId && <div className="workspace-notice"><p>A previous change needs confirmation. Refreshing lists is safe.</p><button className="button" disabled={busy} onClick={() => void checkChange()}>Check change status</button><details><summary>Already verified the result?</summary><p>Check that the event, schedule, or booking shows the intended result before clearing this notice.</p><button className="button" disabled={busy} onClick={() => { savePending(null); setPendingId(null); setError(''); }}>I checked the result — continue</button></details></div>}
    {mode === 'bookings' && <div className="workspace-toolbar"><div className="workspace-filters" aria-label="Booking status">{[['upcoming', 'Upcoming'], ['unconfirmed', 'Pending'], ['past', 'Past'], ['cancelled', 'Cancelled']].map(([value, label]) => <button key={value} aria-pressed={status === value} disabled={busy} onClick={() => setStatus(value)}>{label}</button>)}</div><label>Display time zone<select aria-label="Display time zone" value={zone} onChange={e => onZone(e.target.value)}>{zones.map(z => <option key={z}>{z}</option>)}</select></label></div>}
    {loadingEvent && <p role="status" className="muted">Loading current event settings…</p>}
    {loading && <p role="status" className="muted">Loading {mode === 'bookings' ? 'reservations' : 'availability schedules'}…</p>}
    {mode === 'events' && <div className="workspace-cards">{events.map(event => <article className="panel workspace-card" key={event.id}><CalendarDays size={24} /><h3>{event.title}</h3><p className="muted">{event.description || 'A little time to connect.'}</p><p><Clock3 size={16} /> {event.duration} minutes · Cal.com event</p><p className="muted">Format: {event.formats?.map(f => f.label).join(', ') || 'Not configured'}</p><p className="muted">{schedules.find(s => s.id === event.scheduleId)?.name || 'Organizer availability'}</p><div className="workspace-actions"><button className="button primary" onClick={() => onBook(event.id)}>Book meeting</button><button className="button" disabled={disabled || loading} onClick={() => edit(event)}>Edit event</button></div></article>)}</div>}
    {mode === 'availability' && <div className="workspace-cards">{schedules.map(s => <article className="panel workspace-card" key={s.id}><Clock3 size={24} /><h3>{s.name} {s.isDefault && <span className="badge">Default</span>}</h3><p className="meeting-timezone"><Globe2 size={16} />{s.timeZone}</p>{s.availability.map((a, i) => <p key={i}>{a.days.join(', ')}<br /><strong>{a.startTime} – {a.endTime}</strong></p>)}{s.overrides.map((o, i) => <p key={'o'+i}>{o.date}: {o.startTime} – {o.endTime}</p>)}</article>)}</div>}
    {mode === 'bookings' && <div className="workspace-bookings">{bookings.map(b => {
      const timing = meetingTime(b.start, b.end, zone), active = ['accepted', 'pending'].includes(b.status) && Date.parse(b.end) > Date.now();
      return <article className="panel workspace-booking" key={b.reference}>
        <header className="reservation-header"><h3>{b.title}</h3><span className={'badge ' + (b.status === 'cancelled' ? 'cancelled' : b.status === 'pending' ? 'pending' : 'confirmed')}>{b.rescheduledTo ? 'Rescheduled' : b.status === 'accepted' ? 'Confirmed' : b.status}</span></header>
        <dl className="reservation-details">
          <div className="reservation-when"><dt>Date & time</dt><dd><time dateTime={b.start}>{new Intl.DateTimeFormat('en', { timeZone: zone, dateStyle: 'full' }).format(new Date(b.start))}</time><span className="meeting-clock">{timing.startLabel} – {timing.endLabel}</span><span className="meeting-timezone"><Globe2 size={15} aria-hidden="true" />{timing.zoneLabel}</span></dd></div>
          <div><dt>Meeting format</dt><dd className="booking-format">{b.format || 'Not recorded'}</dd></div>
          <div><dt>Participants</dt><dd><ul className="reservation-people">{b.participants.length ? b.participants.map((name, i) => <li key={i}>{name}</li>) : <li>Not provided</li>}</ul></dd></div>
        </dl>
        {b.cancellationReason && <div className="cancellation-reason"><strong>Cancellation reason:</strong> {b.cancellationReason}</div>}
        <footer className="reservation-footer"><p className="reservation-reference"><span>Booking reference</span><code>{b.reference}</code></p>{active && <div className="workspace-actions"><button className="button" disabled={disabled} onClick={() => { setAction({ booking: b, kind: 'reschedule' }); setReason(''); setConfirmed(false); }}>Reschedule</button><button className="button danger" disabled={disabled} onClick={() => { setAction({ booking: b, kind: 'cancel' }); setReason(''); setConfirmed(false); }}>Cancel meeting</button></div>}</footer>
      </article>;
    })}{!loading && !error && !bookings.length && <div className="panel workspace-empty"><CalendarDays size={32} /><h3>No {status === 'unconfirmed' ? 'pending' : status} meetings</h3><p className="muted">Reservations for this workspace’s public event types appear here.</p></div>}{cursor && <button className="button" disabled={loading} onClick={() => void refresh(true, cursor)}>Load more meetings</button>}</div>}
    {!loading && mode !== 'bookings' && !(mode === 'events' ? events : schedules).length && <p className="workspace-notice">Create your first {mode === 'events' ? 'event' : 'availability schedule'} to get started.</p>}
    {editor && mode !== 'bookings' && <div className="workspace-editor panel" ref={editorRef}><div className="workspace-heading"><h3>{mode === 'events' ? editingId ? 'Edit event' : 'Create event' : 'Create availability schedule'}</h3><button className="icon-button" aria-label="Close editor" disabled={busy} onClick={() => setEditor(false)}><X size={22} /></button></div><form className="form" onSubmit={e => { e.preventDefault(); void (mode === 'events' ? mutate('event-types' + (editingId ? '/' + editingId : ''), { title, slug, duration, description, scheduleId: Number(scheduleId), settings: editingId ? settingsChanges : settings, ...(eventFormat ? { formatId: eventFormat, formatDetail } : {}) }, editingId ? 'PATCH' : 'POST') : mutate('schedules', { name: scheduleName, timeZone: scheduleZone, days: weekdays, startTime, endTime, overrides })); }}><fieldset disabled={disabled}>
      {mode === 'events' ? <><div className="form-grid"><label>Event title<input required maxLength={160} value={title} onChange={e => { setTitle(e.target.value); if (!editingId) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)); }} /></label><label>Duration (minutes)<input type="number" required min={5} max={480} value={duration} onChange={e => setDuration(Number(e.target.value))} /></label></div>{<label>Event URL slug<input required pattern="[a-z0-9]+([-_][a-z0-9]+)*" maxLength={100} value={slug} onChange={e => setSlug(e.target.value)} /><small>Use a unique name such as project-introduction.</small></label>}<label>Description<textarea maxLength={500} rows={3} value={description} onChange={e => setDescription(e.target.value)} /></label><label>Availability schedule<select aria-label="Availability schedule" required value={scheduleId} onChange={e => setScheduleId(e.target.value)}><option value="">Choose a schedule</option>{schedules.map(s => <option key={s.id} value={s.id}>{s.name} · {s.timeZone}</option>)}</select></label><label>Event meeting format<select aria-label="Event meeting format" required={!editingId} value={eventFormat} onChange={e => { setEventFormat(e.target.value); setFormatDetail(''); }}><option value="">{editingId ? 'Keep current formats' : 'Choose a format'}</option>{formatChoices.map(f => <option key={f.id} value={f.id} disabled={!f.available}>{f.label}{f.available ? '' : ' — not connected'}</option>)}</select></label>{['link', 'address', 'phone'].includes(eventFormat) && <label>{eventFormat === 'link' ? 'Meeting link' : eventFormat === 'address' ? 'Meeting address' : 'Meeting phone number'}<input required type={eventFormat === 'link' ? 'url' : eventFormat === 'phone' ? 'tel' : 'text'} maxLength={500} value={formatDetail} onChange={e => setFormatDetail(e.target.value)} placeholder={eventFormat === 'link' ? 'https://…' : eventFormat === 'phone' ? '+12025550123' : 'Street address or venue'} /></label>}<p className="muted">Google Meet, Zoom, and Teams require the organizer’s provider connection. Meeting links, addresses, and phone numbers are included in the invitation. Choosing a new format replaces this event’s offered formats.</p><EventSettingsFields key={editingId || 'new'} value={settings} onChange={patch => { setSettings(old => ({ ...old, ...patch })); setSettingsChanges(old => ({ ...old, ...patch })); }} /></> : <><label>Schedule name<input required maxLength={100} value={scheduleName} onChange={e => setScheduleName(e.target.value)} /></label><label>Schedule time zone<select aria-label="Schedule time zone" value={scheduleZone} onChange={e => setScheduleZone(e.target.value)}>{zones.map(z => <option key={z}>{z}</option>)}</select></label><div className="weekday-picker" role="group" aria-label="Available weekdays">{days.map(d => <label key={d}><input type="checkbox" checked={weekdays.includes(d)} onChange={e => setWeekdays(old => e.target.checked ? [...old, d] : old.filter(x => x !== d))} />{d.slice(0,3)}</label>)}</div><div className="form-grid"><label>Start time<input type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} /></label><label>End time<input type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} /></label></div><h4>Date overrides (optional)</h4><p className="muted">Replace the weekly hours on a specific date.</p>{overrides.map((o, i) => <div className="override-row" key={i}><label>Override date<input aria-label={'Override date ' + (i + 1)} type="date" required value={o.date} onChange={e => setOverrides(old => old.map((x, n) => n === i ? { ...x, date: e.target.value } : x))} /></label><label>From<input type="time" required value={o.startTime} onChange={e => setOverrides(old => old.map((x, n) => n === i ? { ...x, startTime: e.target.value } : x))} /></label><label>Until<input type="time" required value={o.endTime} onChange={e => setOverrides(old => old.map((x, n) => n === i ? { ...x, endTime: e.target.value } : x))} /></label><button type="button" className="button" onClick={() => setOverrides(old => old.filter((_, n) => n !== i))}>Remove</button></div>)}<button className="button" type="button" disabled={overrides.length >= 30} onClick={() => setOverrides(old => [...old, { date: '', startTime: '09:00', endTime: '17:00' }])}>Add date override</button><p className="muted">This creates a separate schedule. Assign it to an event in Events; existing events keep their current schedule.</p></>}
      <button className="button primary" type="submit" disabled={disabled || (mode === 'events' ? !scheduleId || (!editingId && !eventFormat) : !weekdays.length)}>{busy ? 'Saving…' : mode === 'events' ? editingId ? 'Save event' : 'Create event' : 'Create schedule'}</button>
    </fieldset></form></div>}
    {action && <div className="workspace-editor panel" ref={editorRef}><div className="workspace-heading"><h3>{action.kind === 'cancel' ? 'Cancel' : 'Reschedule'}: {action.booking.title}</h3><button className="icon-button" aria-label="Close booking change" disabled={busy} onClick={() => setAction(null)}><X size={22} /></button></div><form className="form" onSubmit={e => { e.preventDefault(); void mutate('bookings/' + encodeURIComponent(action.booking.reference) + '/' + action.kind, { confirmed, reason, ...(action.kind === 'reschedule' ? { start: selected } : {}) }); }}><fieldset disabled={disabled}>{action.kind === 'reschedule' && <><label>New date<input type="date" required value={newDate} onChange={e => setNewDate(e.target.value)} /></label><p className="meeting-timezone">{zone}</p><button type="button" className="button" disabled={finding || !newDate} onClick={() => void findSlots()}>{finding ? 'Checking…' : 'Find new times'}</button><div className="slots public-slots">{slots.map(s => <button type="button" key={s} aria-pressed={selected === s} className={selected === s ? 'chosen' : ''} onClick={() => setSelected(s)}>{timeLabel(s)}</button>)}</div>{searched && !slots.length && <p role="status">No available times. Try another date.</p>}</>}<label>{action.kind === 'cancel' ? 'Cancellation reason' : 'Reason for rescheduling'}<textarea maxLength={500} rows={2} value={reason} onChange={e => setReason(e.target.value)} /></label><label className="public-consent"><input type="checkbox" checked={confirmed} required onChange={e => setConfirmed(e.target.checked)} /><span>The participants agreed to this change. Cal.com may notify them by email.</span></label><button type="submit" className={'button ' + (action.kind === 'cancel' ? 'danger' : 'primary')} disabled={disabled || !confirmed || (action.kind === 'reschedule' && !selected)}>{busy ? 'Saving…' : action.kind === 'cancel' ? 'Confirm cancellation' : 'Confirm new time'}</button></fieldset></form></div>}
  </section>;
}
