"use client";
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3, Users, ArrowRight, CheckCircle2, RefreshCw, Globe2, ShieldCheck, LayoutGrid, ListChecks } from 'lucide-react';
import ThemeToggle from './theme-toggle';
import WorkspaceManagement from './workspace-management';
import { meetingTime } from '../lib/meeting-time.mjs';
import { MEETING_HOST } from '../lib/meeting-host.mjs';

type EventType = { id: number; title: string; duration: number; description: string; formats: { id: string; label: string; input: string | null }[] };
type Receipt = { format?: string; location?: string; reference: string; title: string; start: string; end: string; timeZone: string; status: string; participants: string[]; meetingUrl: string | null };
const pendingKey = 'meetingschedule-pending-booking';
const dateInZone = (date: Date, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
async function call(path: string, options: RequestInit = {}) {
  const response = await fetch('/api/public/' + path, { credentials: 'same-origin', ...options });
  const data = await response.json() as any;
  if (!response.ok) throw Object.assign(new Error(data.error || 'The request could not be completed.'), { status: response.status, uncertain: data.uncertain });
  return data;
}
function pending(value?: string | null) {
  try { if (value === undefined) return sessionStorage.getItem(pendingKey); if (value) sessionStorage.setItem(pendingKey, value); else sessionStorage.removeItem(pendingKey); } catch { /* Booking still works without storage. */ }
  return null;
}
export default function BookingPage() {
  const [tab, setTab] = useState<'book' | 'events' | 'availability' | 'bookings'>('book');
  const [events, setEvents] = useState<EventType[]>([]), [organizer, setOrganizer] = useState('');
  const [ready, setReady] = useState(false), [loading, setLoading] = useState(true), [setupError, setSetupError] = useState('');
  const [formatId, setFormatId] = useState(''), [formatDetail, setFormatDetail] = useState('');
  const [eventId, setEventId] = useState(''), [zone, setZone] = useState('UTC'), [date, setDate] = useState('');
  const [zones, setZones] = useState(['UTC']), [slots, setSlots] = useState<string[]>([]), [slot, setSlot] = useState('');
  const [searching, setSearching] = useState(false), [searched, setSearched] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [uncertain, setUncertain] = useState(false), [receipt, setReceipt] = useState<Receipt | null>(null);
  const [firstName, setFirstName] = useState(''), [firstEmail, setFirstEmail] = useState(''), [notes, setNotes] = useState(''), [agreed, setAgreed] = useState(false);
  const attempt = useRef<string | null>(null), generation = useRef(0), submitting = useRef(false);
  const event = events.find(e => String(e.id) === eventId);
  const format = event?.formats?.find(f => f.id === formatId);
  async function checkReceipt(id = attempt.current) {
    if (!id) return;
    setBusy(true);
    try { const result = await call('receipt?' + new URLSearchParams({ requestId: id })); setReceipt(result.receipt); setUncertain(false); setError(''); pending(null); }
    catch (e: any) { setUncertain(e.uncertain !== false); setError(e.status === 404 ? 'The booking result is not available yet. Check the participants’ email or contact the organizer before making another booking.' : e.message); if (e.uncertain === false) { pending(null); attempt.current = null; } }
    finally { setBusy(false); }
  }
  async function refreshConfig() { const data = await call('config'); setEvents(data.events); setOrganizer(data.organizerEmail); }
  async function initialize() {
    setLoading(true); setSetupError('');
    try {
      const data = await call('config'); setReady(data.ready); setEvents(data.events); setOrganizer(data.organizerEmail); setEventId(current => current || String(data.events[0]?.id || ''));
      const id = pending(); if (id) { attempt.current = id; setUncertain(true); await checkReceipt(id); }
    } catch (e: any) { setReady(false); setSetupError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setZone(local); setDate(dateInZone(new Date(), local));
    const supported = (Intl as any).supportedValuesOf?.('timeZone') || ['Europe/Berlin', 'Asia/Yakutsk', 'America/New_York', 'Asia/Tokyo'];
    setZones([...new Set<string>(['UTC', local, ...supported])]);
    void initialize();
  }, []);
  useEffect(() => { generation.current++; setSlots([]); setSlot(''); setSearched(false); setSearching(false); }, [eventId, date, zone, events]);
  useEffect(() => { setFormatId(''); setFormatDetail(''); }, [eventId, events]);
  useEffect(() => { setFormatDetail(''); }, [formatId]);
  async function findSlots() {
    const current = ++generation.current;
    setSearching(true); setError(''); setSlots([]); setSlot(''); setSearched(false);
    try {
      const data = await call('slots?' + new URLSearchParams({ eventTypeId: eventId, date, timeZone: zone }));
      if (current === generation.current) { setSlots(data.slots); setSearched(true); }
    } catch (e: any) { if (current === generation.current) setError(e.message); }
    finally { if (current === generation.current) setSearching(false); }
  }
  async function book(e: React.FormEvent) {
    e.preventDefault(); if (submitting.current || uncertain || !slot || !event || !format) return;
    if (firstEmail.trim().toLowerCase() === organizer.trim().toLowerCase()) { setError('Enter your own email address, different from the host’s email.'); return; }
    submitting.current = true; setBusy(true); setError('');
    const id = crypto.randomUUID(); attempt.current = id; pending(id);
    try {
      const data = await call('bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify({ eventTypeId: event.id, formatId, formatDetail, start: slot, timeZone: zone, first: { name: firstName, email: firstEmail }, notes, agreed }) });
      setReceipt(data.receipt); pending(null);
    } catch (e: any) {
      const unknown = e.uncertain || !e.status || e.status >= 500;
      setUncertain(unknown); setError(unknown ? 'The booking result could not be confirmed. Check both participants’ email or use Check booking status before making another booking.' : e.message);
      if (!unknown) { attempt.current = null; pending(null); }
    } finally { submitting.current = false; setBusy(false); }
  }
  function reset() { setReceipt(null); setFormatId(''); setFormatDetail(''); setSlot(''); setSlots([]); setSearched(false); setFirstName(''); setFirstEmail(''); setNotes(''); setAgreed(false); setError(''); attempt.current = null; pending(null); }
  const disabled = !ready || loading || busy || uncertain || !!receipt;
  const time = (value: string) => new Intl.DateTimeFormat('en', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
  return <div className="public-shell">
    <header className="public-topbar">
      <a className="brand" href="/" aria-label="MeetingSchedule home"><span className="brand-icon"><CalendarDays size={25} /></span><span>MeetingSchedule<small>SCHEDULING WORKSPACE</small></span></a>
      <ThemeToggle />
    </header>
    <div className="workspace-layout">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <div className="workspace-sidebar-inner"><p className="eyebrow sidebar-caption">WORKSPACE</p>
          <nav className="workspace-nav" aria-label="Dashboard sections">{([['book', 'Book a meeting', CalendarDays], ['events', 'Events', LayoutGrid], ['availability', 'Availability', Clock3], ['bookings', 'Bookings', ListChecks]] as const).map(([value, label, Icon]) => <button key={value} title={label} aria-label={label} aria-pressed={tab === value} disabled={!ready} onClick={() => setTab(value)}><Icon size={21} aria-hidden="true" /><span>{label}</span></button>)}</nav>
          <div className="sidebar-contact"><span className="recipient-avatar" aria-hidden="true">TR</span><strong>{MEETING_HOST.name}</strong><span>{organizer}</span><small>Your meeting host</small></div>
        </div>
      </aside>
      <main className="public-main">
      <div className="public-intro"><p className="eyebrow">OPEN TO EVERYONE</p><h1>{tab === 'book' ? 'Meet with Travis Ruiz.' : 'A place for every conversation.'}</h1><p>{tab === 'book' ? 'Choose a time and enter your name and email. Travis is your host. No sign-up needed.' : 'Create events, set available hours, and manage meetings with Travis.'}</p></div>
      {ready && <p className="shared-context">Shared scheduling for {organizer}. Public event reservations and cancellations are visible to dashboard visitors.</p>}
      {ready && tab !== 'book' && <WorkspaceManagement mode={tab} events={events} zone={zone} zones={zones} onZone={setZone} onUpdate={refreshConfig} onBook={id => { setEventId(String(id)); reset(); setTab('book'); }} />}
      <div hidden={tab !== 'book'}>
      {loading && <div role="status" className="loading"><RefreshCw className="spinning" size={20} /> Checking available meetings…</div>}
      {!loading && !ready && <section className="panel public-message" role="alert"><h2>Booking is not available yet</h2><p>{setupError}</p><button className="button" onClick={() => void initialize()}><RefreshCw size={18} /> Check again</button></section>}
      {!loading && ready && !events.length && <section className="panel public-message" role="status"><h2>No meeting types available</h2><p>The organizer needs to make a meeting type available for booking with Travis.</p><button className="button" onClick={() => void initialize()}><RefreshCw size={18} /> Check again</button></section>}
      {receipt ? <section className="panel public-receipt" aria-live="polite">
        <CheckCircle2 size={38} /><p className="eyebrow">{receipt.status === 'accepted' ? 'BOOKING CONFIRMED' : 'REQUEST RECEIVED'}</p>
        <h2>{receipt.status === 'accepted' ? 'Your meeting is booked.' : 'Your meeting is awaiting approval.'}</h2>
        <h3 className="receipt-title">{receipt.title}</h3>
        <dl className="reservation-details receipt-details">
          <div className="reservation-when"><dt>Date & time</dt><dd><time dateTime={receipt.start}>{new Intl.DateTimeFormat('en', { timeZone: receipt.timeZone, dateStyle: 'full' }).format(new Date(receipt.start))}</time><span className="meeting-clock">{meetingTime(receipt.start, receipt.end, receipt.timeZone).startLabel} – {meetingTime(receipt.start, receipt.end, receipt.timeZone).endLabel}</span><span className="meeting-timezone"><Globe2 size={15} aria-hidden="true" />{meetingTime(receipt.start, receipt.end, receipt.timeZone).zoneLabel}</span></dd></div>
          <div><dt>Meeting format</dt><dd className="booking-format">{receipt.format || 'Not recorded'}</dd></div>
          <div><dt>Participants</dt><dd><ul className="reservation-people">{receipt.participants.map((name, i) => <li key={i}>{name}</li>)}</ul></dd></div>
          {receipt.location && <div className="receipt-location"><dt>Meeting location</dt><dd>{receipt.location}</dd></div>}
        </dl>
        <p>Check both participants’ inboxes for the invitation and booking details{receipt.status === 'accepted' ? '.' : ' after the organizer approves the request.'}</p>
        {receipt.meetingUrl && <a className="button primary" href={receipt.meetingUrl} target="_blank" rel="noreferrer">Open meeting link <ArrowRight size={18} /></a>}
        <p className="reservation-reference"><span>Booking reference</span><code>{receipt.reference}</code></p><button className="button" onClick={reset}>Book another meeting</button>
      </section> : ready && events.length > 0 && <form className="public-grid" onSubmit={book}>
        <div className="public-form-column">
          {error && <div role="alert" className="alert error public-error"><p>{error}</p>{uncertain && <><button type="button" className="button" disabled={busy} onClick={() => void checkReceipt()}>Check booking status</button>{organizer && <a href={'mailto:' + organizer}>Contact organizer</a>}</>}</div>}
          <fieldset className="panel public-section" disabled={disabled}>
            <legend><span>1</span> Choose a meeting time</legend>
            <div className="form inner-form"><label>Meeting type<select aria-label="Meeting type" value={eventId} onChange={e => setEventId(e.target.value)} required>{events.map(e => <option key={e.id} value={e.id}>{e.title} · {e.duration} minutes</option>)}</select></label>
              <label>Meeting format<select aria-label="Meeting format" required value={formatId} onChange={e => setFormatId(e.target.value)}><option value="">Choose a meeting format</option>{event?.formats?.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
              {!event?.formats?.length && <p role="status" className="public-hint">No supported format is configured for this event. Choose another event or set its format in Events.</p>}
              {format?.input && <label>{format.input === 'phone' ? 'Your phone number' : format.input === 'address' ? 'Meeting address' : 'Meeting location'}<input required maxLength={500} type={format.input === 'phone' ? 'tel' : 'text'} value={formatDetail} onChange={e => setFormatDetail(e.target.value)} placeholder={format.input === 'phone' ? '+12025550123' : 'Enter the meeting location'} /></label>}
              <p className="public-hint">Formats are set for each event. Google Meet is available when the organizer connects it and adds it to this event.</p>
              {event?.description && <p className="muted">{event.description}</p>}
              <div className="form-grid"><label>Date<input type="date" value={date} min={dateInZone(new Date(), zone)} max={dateInZone(new Date(Date.now() + 365 * 86400000), zone)} required onChange={e => setDate(e.target.value)} /></label>
              <label>Time zone<select aria-label="Time zone" value={zone} onChange={e => setZone(e.target.value)}>{zones.map(z => <option key={z} value={z}>{z}</option>)}</select></label></div>
              <button className="button" type="button" onClick={() => void findSlots()} disabled={searching || !eventId || !date}>{searching ? <RefreshCw className="spinning" size={18} /> : <Clock3 size={18} />}{searching ? 'Checking times…' : 'Find available times'}</button>
              {searched && <div role="status"><p>{slots.length ? 'Select an available time' : 'No available times on this date. Try another day.'}</p><div className="slots public-slots">{slots.map(s => <button key={s} type="button" aria-pressed={slot === s} className={slot === s ? 'chosen' : ''} onClick={() => setSlot(s)}>{time(s)}</button>)}</div></div>}
              <p className="public-hint">Times follow the organizer’s availability. Choose a time that works for you.</p>
            </div>
          </fieldset>
          <fieldset className="panel public-section" disabled={disabled}>
            <legend><span>2</span> Your details</legend>
            <div className="form inner-form"><p>Your invitation will be sent to this address. Gmail and other personal or business email addresses are welcome.</p>
              <div className="form-grid"><label>Your name<input required maxLength={100} autoComplete="name" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Full name" /></label><label>Your email<input required type="email" maxLength={254} autoComplete="email" value={firstEmail} onChange={e => setFirstEmail(e.target.value)} placeholder="you@gmail.com" /></label></div>
              <label>Meeting notes (optional)<textarea rows={3} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="What would you like to discuss?" /></label>
            </div>
          </fieldset>
        </div>
        <aside className="panel public-summary">
          <div className="public-summary-icon"><Users size={28} /></div><p className="eyebrow">YOUR MEETING</p><h2>Review & book</h2>
          <h3>{event?.title || 'Choose a meeting type'}</h3>
          <dl className="summary-details">
            <div><dt>Meeting format</dt><dd className="booking-format">{format?.label || 'Choose a format'}</dd></div>
            <div><dt>Duration</dt><dd>{event ? `${event.duration} minutes` : 'Choose a meeting type'}</dd></div>
            <div className="summary-when"><dt>Date & time</dt><dd>{slot ? <><time dateTime={slot}>{new Intl.DateTimeFormat('en', { timeZone: zone, dateStyle: 'full' }).format(new Date(slot))}</time><span className="meeting-clock">{meetingTime(slot, new Date(Date.parse(slot) + (event?.duration || 30) * 60000).toISOString(), zone).startLabel} – {meetingTime(slot, new Date(Date.parse(slot) + (event?.duration || 30) * 60000).toISOString(), zone).endLabel}</span><span className="meeting-timezone"><Globe2 size={15} aria-hidden="true" />{meetingTime(slot, new Date(Date.parse(slot) + (event?.duration || 30) * 60000).toISOString(), zone).zoneLabel}</span></> : <span className="muted">Select an available time</span>}</dd></div>
          </dl>
          <div className="public-participants"><div><span>Your name</span><p>{firstName.trim() || 'You'}</p></div><div><span>Meeting with</span><p>{MEETING_HOST.name}</p><small>{organizer}</small></div></div>
          <label className="public-consent"><input type="checkbox" required checked={agreed} disabled={disabled} onChange={e => setAgreed(e.target.checked)} /><span>I agree to receive the invitation for my meeting with Travis Ruiz.</span></label>
          <button className="button primary" type="submit" disabled={disabled || !slot || !agreed || !format || (!!format?.input && !formatDetail.trim())}>{busy ? 'Booking…' : 'Confirm booking'}<ArrowRight size={18} /></button>
          <p className="public-hint"><ShieldCheck size={18} /> No account needed. Manage reservations in the Bookings tab.</p>
        </aside>
      </form>}
      </div>
      <footer className="public-footer"><span>MeetingSchedule · Powered by Cal.com</span>{organizer && <span>Organized by {organizer}</span>}</footer>
    </main>
    </div>
  </div>;
}
