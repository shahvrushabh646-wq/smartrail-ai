import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const CLASSES = ['1A', '2A', '3A', '3E', 'SL', '2S', 'CC', 'EC', 'EA', 'EV', 'FC'];
const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const todayValues = Object.fromEntries(todayParts.map(part => [part.type, part.value]));
const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;

function App() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(today);
  const [travelClass, setTravelClass] = useState('ALL');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [apiStatus, setApiStatus] = useState('checking');
  const [providerReady, setProviderReady] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error('API unavailable');
        setProviderReady(Boolean(payload.scheduleProviderConfigured));
        setApiStatus('online');
      })
      .catch(() => setApiStatus('offline'));
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
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ from, to, date, travelClass })
      });
      const raw = await response.text();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        const hint = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        throw new Error(`Search API returned a non-JSON response (HTTP ${response.status}). ${hint || 'Check the Vercel deployment.'}`);
      }
      if (!response.ok) throw new Error(payload.detail ? `${payload.error || 'Search failed.'} ${payload.detail}` : (payload.error || `Search failed (HTTP ${response.status}).`));
      setData(payload);
    } catch (exception) {
      setError(exception.message || 'Unable to search right now.');
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
        <span className={`live ${apiStatus}`}>● {apiStatus === 'online' ? (providerReady ? 'LIVE DATA SOURCE READY' : 'API ONLINE · DATA SOURCE SETUP NEEDED') : apiStatus === 'checking' ? 'CHECKING API' : 'API OFFLINE'}</span>
      </header>

      <section className="hero">
        <p className="eyebrow">A SMARTER WAY TO TRAVEL</p>
        <h1>Your journey,<br /><em>intelligently connected.</em></h1>
        <p className="sub">Compare direct trains and practical connecting routes in one search.</p>
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
          </div>
          <button className="search-button" disabled={busy || apiStatus === 'offline'}>{busy ? 'SEARCHING…' : 'Search trains →'}</button>
        </form>
      </section>

      <section className="results">
        <div className="sectionhead">
          <div><p className="eyebrow">YOUR OPTIONS</p><h2>Journey results</h2></div>
          <span className="pill">{data?.source === "RailCore" ? "Live direct trains · independent provider" : "Direct + via-station journey planner"}</span>
        </div>

        {error && <div className="error" role="alert"><b>Search could not be completed</b><span>{error}</span></div>}
        {!data && !error && <div className="empty">Enter your journey details to search direct and via-station routes.</div>}
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
                  <div className="classrow" key={item.class}>
                    <b>{item.class}</b>
                    <span className={item.results?.length ? 'confirmed' : item.freshness === 'STALE' || item.freshness === 'UNKNOWN' ? 'stale' : item.status === 'OK' ? 'notavailable' : 'unchecked'}>
                      <strong className="availability-state">
                        {item.results?.length
                          ? (item.results[0].availabilityText || "AVAILABLE") + (item.results[0].availableCount != null ? " · Provider reported " + item.results[0].availableCount + " seats" : "") + (item.results[0].fare != null ? " · Provider fare ₹" + item.results[0].fare : "")
                          : item.freshness === 'STALE'
                            ? "STALE"
                            : item.freshness === 'UNKNOWN'
                              ? "UNVERIFIED"
                              : item.status === "OK"
                                ? (item.providerStatus === 'NOT_AVAILABLE' ? 'NOT AVAILABLE' : item.reason || item.providerStatus || "Not available")
                                : item.status === "ERROR" ? "PROVIDER ERROR" : "NOT CHECKED"}
                      </strong>
                      {item.reason && (item.freshness === 'STALE' || item.freshness === 'UNKNOWN' || item.status !== 'OK' || item.providerStatus !== 'AVAILABLE') && <small>{item.reason}</small>}
                      {item.providerStatus && <small>Provider status: {item.providerStatus}</small>}
                      {item.fetchedAt && <small>Last provider update: {new Date(item.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</small>}
                      {item.freshnessAgeMinutes != null && <small>{item.freshness === 'STALE' ? `Data age: ${item.freshnessAgeMinutes} min · exceeds ${item.freshnessThresholdMinutes || 15}-min freshness limit` : `Data age: ${item.freshnessAgeMinutes} min · within ${item.freshnessThresholdMinutes || 15}-min freshness limit`}</small>}
                    </span>
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
