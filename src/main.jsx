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
  const [irctcSnapshots, setIrctcSnapshots] = useState([]);
  const [extensionStatus, setExtensionStatus] = useState('checking');
  const [bridgeStatus, setBridgeStatus] = useState('');

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
        setApiStatus('online');
      })
      .catch(() => setApiStatus('offline'))
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  useEffect(() => {
    function handleBridgeMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data;
      if (!message) return;
      if (message.type === 'SMARTRAIL_IRCTC_BRIDGE_STATUS') {
        setBridgeStatus(String(message.payload || ''));
        return;
      }
      if (!['SMARTRAIL_IRCTC_RESPONSE', 'SMARTRAIL_IRCTC_UPDATE'].includes(message.type)) return;
      const payload = message.payload || {};
      setExtensionStatus(payload.installed ? 'connected' : 'not-installed');
      setIrctcSnapshots(Array.isArray(payload.snapshots) ? payload.snapshots : []);
    }
    window.addEventListener('message', handleBridgeMessage);
    window.postMessage({ type: 'SMARTRAIL_IRCTC_REQUEST' }, window.location.origin);
    const detectTimer = setTimeout(() => setExtensionStatus(current => current === 'checking' ? 'not-detected' : current), 1800);
    return () => {
      clearTimeout(detectTimer);
      window.removeEventListener('message', handleBridgeMessage);
    };
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
    window.postMessage({ type: 'SMARTRAIL_IRCTC_AUTO_SEARCH', payload: { from, to, date, travelClass } }, window.location.origin);
    window.postMessage({ type: 'SMARTRAIL_IRCTC_REQUEST' }, window.location.origin);
    try {
      const response = await fetch(`/api/search?fresh=${Date.now()}`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache',
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
        <span className={`live ${apiStatus}`}>● {apiStatus === 'online' ? 'API ONLINE · CHROME BRIDGE' : apiStatus === 'checking' ? 'CHECKING API' : 'API CHECK FAILED · TRY SEARCH'}</span>
      </header>

      <section className="hero">
        <p className="eyebrow">A SMARTER WAY TO TRAVEL</p>
        <h1>Your journey,<br /><em>intelligently connected.</em></h1>
        <p className="sub">Compare direct trains and connecting routes via an interchange station.</p>
        <form onSubmit={search}>
          <div className="fields">
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

          <section className="browser-availability" aria-label="IRCTC browser availability">
            <div className="browser-availability-head">
              <div>
                <b>IRCTC browser availability</b>
                <small>{extensionStatus === 'connected' ? 'Chrome extension connected' : extensionStatus === 'checking' ? 'Checking browser extension…' : 'Extension not detected'}</small>
              </div>
              <button type="button" className="bridge-refresh" onClick={() => window.postMessage({ type: 'SMARTRAIL_IRCTC_REQUEST' }, window.location.origin)}>Refresh from browser</button>
            </div>
            {extensionStatus !== 'connected' && <p className="bridge-help">Install the SmartRail IRCTC Availability Bridge extension. When you press Search trains, it will open or focus IRCTC automatically; sign in if needed, search your journey, and make the class-wise availability visible. <a href="https://github.com/shahvrushabh646-wq/smartrail-ai/tree/main/extension" target="_blank" rel="noreferrer">Installation steps ↗</a></p>}
            {bridgeStatus && <p className="bridge-help">{bridgeStatus}</p>}
            {extensionStatus === 'connected' && irctcSnapshots.filter(item => !item.date || item.date === date).length === 0
              ? <p className="bridge-help">Extension is connected, but no matching status has been captured for this journey date yet. In the automatically opened IRCTC tab, search the same journey and make the availability text visible.</p>
              : <div className="browser-status-list">
                  {irctcSnapshots.filter(item => !item.date || item.date === date).slice(0, 24).map((item, index) => (
                    <div className="browser-status" key={item.trainNo + item.travelClass + item.date + index}>
                      <b>{item.trainNo}</b><span>{item.trainName || 'Train status'}</span><strong>{item.travelClass}</strong><em>{item.statusText}</em>
                      <small>Observed {new Date(item.observedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · Browser-visible IRCTC</small>
                    </div>
                  ))}
                </div>}
            {irctcSnapshots.length > 0 && <button type="button" className="bridge-clear" onClick={() => {
              window.postMessage({ type: 'SMARTRAIL_IRCTC_CLEAR' }, window.location.origin);
              setIrctcSnapshots([]);
            }}>Clear captured statuses</button>}
          </section>

      <section className="results">
        <div className="sectionhead">
          <div><p className="eyebrow">YOUR OPTIONS</p><h2>Journey results</h2></div>
          <span className="pill">Local timetable + Chrome bridge</span>
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
      <footer>SmartRail AI · No invented trains or seat availability. Recheck before booking.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
