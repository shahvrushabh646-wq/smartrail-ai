import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const CLASSES = ['1A', '2A', '3A', '3E', 'SL', '2S', 'CC', 'EC', 'EA', 'EV', 'FC'];
const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const todayValues = Object.fromEntries(todayParts.map(part => [part.type, part.value]));
const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;

function readableError(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(readableError).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const preferred = ['message', 'error', 'detail', 'reason', 'description', 'code'];
    const parts = preferred.filter(key => value[key] != null).map(key => {
      const item = readableError(value[key]);
      return item ? (key === 'message' ? item : `${key}: ${item}`) : '';
    }).filter(Boolean);
    return parts.length ? parts.join(' · ') : JSON.stringify(value);
  }
  return String(value);
}

function App() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(today);
  const [travelClass, setTravelClass] = useState('ALL');
  const [routeType, setRouteType] = useState('ALL');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [apiStatus, setApiStatus] = useState('checking');
  const [providerReady, setProviderReady] = useState(false);
  const [irctcDevConfigured, setIrctcDevConfigured] = useState(false);
  const [irctcAccessCode, setIrctcAccessCode] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch('/api/health', { cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal })
      .then(async response => {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error(`Health endpoint returned a non-JSON response (HTTP ${response.status}).`);
        }
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || `Health check failed (HTTP ${response.status}).`);
        setProviderReady(Boolean(payload.scheduleProviderConfigured || payload.backupScheduleProviderConfigured || payload.customAvailabilityProviderConfigured || payload.irctcDevConfigured));
        setIrctcDevConfigured(Boolean(payload.irctcDevConfigured));
        setApiStatus('online');
      })
      .catch(() => setApiStatus('offline'))
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  function swapStations() {
    setFrom(to);
    setTo(from);
  }

  async function search(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setData(null);
    try {
      const response = await fetch(`/api/search?fresh=${Date.now()}`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache',
          ...(irctcAccessCode ? { 'x-smr-personal-access-code': irctcAccessCode } : {})
        },
        body: JSON.stringify({ from, to, date, travelClass, routeType })
      });
      const raw = await response.text();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        const hint = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        throw new Error(`Search API returned a non-JSON response (HTTP ${response.status}). ${hint || 'Check the Vercel deployment.'}`);
      }
      if (!response.ok) {
        const message = readableError(payload.error) || `Search failed (HTTP ${response.status}).`;
        const detail = readableError(payload.detail);
        throw new Error(detail ? `${message} — ${detail}` : message);
      }
      if (!Array.isArray(payload.results)) {
        throw new Error('Search API response is missing the results list. Check the deployed API version.');
      }
      setData(payload);
    } catch (exception) {
      setError(readableError(exception?.message) || readableError(exception) || 'Unable to search right now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <div className="brand">
          <span className="mark">↗</span>
          <div><b>SmartRail <i>AI</i></b><small>INDIAN RAIL JOURNEY PLANNER</small></div>
        </div>
        <span className={`live ${apiStatus}`}>● {apiStatus === 'online' ? (providerReady ? 'LIVE DATA SOURCE READY' : 'API ONLINE · DATA SOURCE SETUP NEEDED') : apiStatus === 'checking' ? 'CHECKING API' : 'API CHECK FAILED · TRY SEARCH'}</span>
      </header>

      <section className="hero">
        <p className="eyebrow">A SMARTER WAY TO TRAVEL</p>
        <h1>Your journey,<br /><em>intelligently connected.</em></h1>
        <p className="sub">Compare direct trains and connecting routes via an interchange station.</p>
        <form onSubmit={search}>
          <div className="fields">
            {irctcDevConfigured && <label>PERSONAL ACCESS CODE
              <input type="password" value={irctcAccessCode} onChange={e => setIrctcAccessCode(e.target.value)} placeholder="Enter your private access code" autoComplete="off" />
            </label>}
            <label>FROM
              <input value={from} onChange={e => setFrom(e.target.value)} placeholder="e.g. PUNE or Pune Junction" autoComplete="off" required />
            </label>
            <button className="swap" type="button" onClick={swapStations} aria-label="Swap stations" title="Swap stations">⇄</button>
            <label>TO
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="e.g. CSMT or Mumbai CSMT" autoComplete="off" required />
            </label>
            <label>JOURNEY DATE
              <input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} required />
            </label>
            <label>TRAVEL CLASS
              <select value={travelClass} onChange={e => setTravelClass(e.target.value)}>
                <option value="ALL">All Classes</option>
                {CLASSES.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>JOURNEY TYPE
              <select value={routeType} onChange={e => setRouteType(e.target.value)}>
                <option value="ALL">Direct + Via</option>
                <option value="DIRECT">Direct trains only</option>
                <option value="VIA">Via station only</option>
              </select>
            </label>
          </div>
          <button className="search-button" disabled={busy}>{busy ? 'SEARCHING…' : 'Search trains →'}</button>
        </form>
      </section>

      <section className="results">
        <div className="sectionhead">
          <div><p className="eyebrow">YOUR OPTIONS</p><h2>Journey results</h2></div>
          <span className="pill">{data?.source?.includes("RailCore") && data?.source?.includes("RailRadar") ? "Multi-source journey results" : data?.source === "RailCore" ? "Live direct trains · independent provider" : "Direct + via-station journey planner"}</span>
        </div>

        {error && <div className="error" role="alert"><b>Search could not be completed</b><span>{error}</span></div>}
        {!data && !error && <div className="empty">Choose Direct + Via, Direct only, or Via station only, then enter your journey details.</div>}
        {data && <>
          <div className="notice">{data.sourceNote}</div>
          {data.results.length === 0
            ? <div className="empty"><b>No matching routes found.</b><span>{data.timetableRecords === 0 && !data.source ? "Connect a train-data provider to enable live journey search." : "No train matched this station pair on the selected date. Try station codes or another date."}</span></div>
            : data.results.map((route, index) => (
              <article className="result" key={index}>
                <div className="route"><b>{route.segments[0].fromName || route.segments[0].from} → {route.segments[route.segments.length - 1].toName || route.segments[route.segments.length - 1].to}</b><span>{route.segments.length === 1 ? 'DIRECT' : `VIA ${route.via}`}</span></div>
                <div className="train-summary">{route.segments.map((segment, segmentIndex) => <div className="train-leg" key={segment.trainNo + "-" + segment.from + "-" + segment.departureTime}><div className="train-title"><span className="train-number">{segment.trainNo || "Train"}</span> {segment.name || "Unnamed train"}</div><div className="train-time"><span>{segment.fromName || segment.from} <b>{segment.departureTime || "—"}</b></span><span className="time-arrow">→</span><span>{segment.toName || segment.to} <b>{segment.arrivalTime || "—"}</b></span></div></div>)}</div>
                {route.interchangeMinutes != null && <small className="buffer">Connection buffer: {Math.floor(route.interchangeMinutes / 60)}h {route.interchangeMinutes % 60}m</small>}
                {route.availability.length === 0 && <div className="classrow"><b>No common class</b><span>Not offered on every leg</span></div>}
                {route.availability.map(item => (
                  <div className="classrow" key={`${item.class}-${item.source || 'unknown'}`}>
                    <b>{item.class}</b>
                    <span className={item.results?.length ? 'confirmed' : item.freshness === 'STALE' || item.freshness === 'UNKNOWN' ? 'stale' : item.status === 'OK' ? 'notavailable' : 'unchecked'}>
                      <strong className="availability-state">
                        {item.results?.length
                          ? (item.results[0].availabilityText || "AVAILABLE") + (item.results[0].availableCount != null ? " · Provider reported " + item.results[0].availableCount + " seats" : "") + (item.results[0].fare != null ? " · Provider fare ₹" + item.results[0].fare : "")
                          : item.freshness === 'STALE'
                            ? "STALE"
                            : item.freshness === 'UNKNOWN'
                              ? `UNVERIFIED · provider says ${item.providerStatus || "unknown"}`
                              : item.status === "OK"
                                ? (item.providerStatus === 'NOT_AVAILABLE' ? 'NOT AVAILABLE' : item.reason || item.providerStatus || "Not available")
                                : item.status === "ERROR" ? "PROVIDER ERROR" : "NOT CHECKED"}
                      </strong>
                      {item.reason && (item.freshness === 'STALE' || item.freshness === 'UNKNOWN' || item.status !== 'OK' || item.providerStatus !== 'AVAILABLE') && <small>{item.reason}</small>}
                      {(item.source || (item.results?.length ? data.source : null)) && <small>Availability source: {item.source || data.source}</small>}
                      {item.providerStatus && <small>Provider status: {item.providerStatus}</small>}
                      {item.fetchedAt && <small>Last provider update: {new Date(item.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</small>}
                      {item.freshnessAgeMinutes != null && <small>{item.freshness === 'STALE' ? `Data age: ${item.freshnessAgeMinutes} min · exceeds ${item.freshnessThresholdMinutes || 15}-min freshness limit` : `Data age: ${item.freshnessAgeMinutes} min · within ${item.freshnessThresholdMinutes || 15}-min freshness limit`}</small>}
                    </span>
                    <a className="irctc-verify" href="https://www.irctc.co.in/nget/train-search" target="_blank" rel="noreferrer">Verify live on official IRCTC ↗</a>
                  </div>
                ))}
              </article>
            ))}
        </>}
      </section>
      <section className="partners" aria-labelledby="partners-title">
        <div className="sectionhead">
          <div><p className="eyebrow">DATA PARTNERSHIPS</p><h2 id="partners-title">Help us bring verified rail data to SmartRail</h2></div>
          <span className="pill">PARTNERSHIP ENQUIRIES</span>
        </div>
        <p className="partners-intro">SmartRail currently combines its configured RailCore and RailRadar feeds where both are available. RailYatri, ixigo/ConfirmTkt and direct IRCTC data feeds are not connected: their authorised API access and written terms have not been provided to SmartRail.</p>
        <div className="partner-grid">
          <article className="partner-card">
            <div className="partner-top"><h3>RailYatri</h3><span className="partner-tag">First contact</span></div>
            <p>Explore a licensed train-search and seat-availability data partnership.</p>
            <a href="https://www.railyatri.in/contact-us" target="_blank" rel="noreferrer">Official contact page ↗</a>
          </article>
          <article className="partner-card">
            <div className="partner-top"><h3>ixigo / ConfirmTkt</h3><span className="partner-tag">First contact</span></div>
            <p>Ask about authorised API access or a commercial data-sharing agreement.</p>
            <a href="https://www.ixigo.com/" target="_blank" rel="noreferrer">Official ixigo website ↗</a>
          </article>
          <article className="partner-card">
            <div className="partner-top"><h3>TripJack</h3><span className="partner-tag">B2B lead</span></div>
            <p>Approach its B2B team to confirm whether a suitable rail-data integration is available.</p>
            <a href="https://www.tripjack.com/" target="_blank" rel="noreferrer">Official TripJack website ↗</a>
          </article>
        </div>
        <div className="community-sources">
          <div className="community-heading">
            <h3>Community integration candidates</h3>
            <span className="partner-tag">ADDED · DISABLED</span>
          </div>
          <p className="community-intro">These three projects are recorded in SmartRail as integration candidates. They are not called for live searches unless their data access and reuse permissions are independently verified.</p>
          <div className="partner-grid">
            <article className="partner-card">
              <div className="partner-top"><h3>ConfirmTkt MCP</h3><span className="partner-tag">Disabled</span></div>
              <p>Community connector for train search and seat availability. Its reverse-engineered endpoint is not enabled; the code licence does not grant ConfirmTkt data/API rights.</p>
              <a href="https://github.com/uditya-kumar/confirmtkt-mcp" target="_blank" rel="noreferrer">View source project ↗</a>
            </article>
            <article className="partner-card">
              <div className="partner-top"><h3>RailIN</h3><span className="partner-tag">Disabled</span></div>
              <p>Personal-use scraping project. No verified licence or permission for SmartRail service use; therefore no scraping or live requests are made.</p>
              <a href="https://github.com/ash2shukla/RailIN" target="_blank" rel="noreferrer">View source project ↗</a>
            </article>
            <article className="partner-card">
              <div className="partner-top"><h3>MANIT RailwayAPI</h3><span className="partner-tag">Disabled</span></div>
              <p>Experimental railway-site crawler/API. Repository code terms do not establish permission to scrape or redistribute railway data.</p>
              <a href="https://github.com/MANIT-Bhopal/RailwayAPI" target="_blank" rel="noreferrer">View source project ↗</a>
            </article>
          </div>
        </div>
        <div className="partner-disclaimer">Partner status: RailYatri — awaiting authorised feed; ixigo/ConfirmTkt — awaiting authorised feed; IRCTC — separate eligible access/approval required. The three community projects above are listed but disabled. Existing RailCore/RailRadar results remain separately labelled. No private app APIs, scraping, or reused credentials are used.</div>
      </section>
      <footer>SmartRail AI · No invented trains or seat availability. Recheck before booking.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
