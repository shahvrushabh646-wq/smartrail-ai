import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const CLASSES = ['1A', '2A', '3A', '3E', 'SL', '2S', 'CC', 'EC', 'EA', 'EV', 'FC'];
const now = new Date();
const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');

function App() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(today);
  const [travelClass, setTravelClass] = useState('ALL');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [apiStatus, setApiStatus] = useState('checking');

  useEffect(() => {
    fetch('/api/health')
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error('API unavailable');
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
      if (!response.ok) throw new Error(payload.error || `Search failed (HTTP ${response.status}).`);
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
        <span className={`live ${apiStatus}`}>● {apiStatus === 'online' ? 'SEARCH API ONLINE' : apiStatus === 'checking' ? 'CHECKING API' : 'API OFFLINE'}</span>
      </header>

      <section className="hero">
        <p className="eyebrow">A SMARTER WAY TO TRAVEL</p>
        <h1>Your journey,<br /><em>intelligently connected.</em></h1>
        <p className="sub">Compare direct trains and practical connecting routes in one search.</p>
        <form onSubmit={search}>
          <div className="fields">
            <label>FROM
              <input value={from} onChange={e => setFrom(e.target.value)} placeholder="Station name or code" autoComplete="off" required />
            </label>
            <button className="swap" type="button" onClick={swapStations} aria-label="Swap stations" title="Swap stations">⇄</button>
            <label>TO
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="Station name or code" autoComplete="off" required />
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
          <span className="pill">Confirmed-only split routes</span>
        </div>

        {error && <div className="error" role="alert"><b>Search could not be completed</b><span>{error}</span></div>}
        {!data && !error && <div className="empty">Enter your journey details to search direct and via-station routes.</div>}
        {data && <>
          <div className="notice">{data.sourceNote}</div>
          {data.results.length === 0
            ? <div className="empty"><b>No matching routes found.</b><span>{data.timetableRecords === 0 ? 'The app is running, but a verified timetable feed has not been added yet.' : 'Try another station name or station code.'}</span></div>
            : data.results.map((route, index) => (
              <article className="result" key={index}>
                <div className="route"><b>{route.segments[0].from} → {route.segments[route.segments.length - 1].to}</b><span>{route.segments.length === 1 ? 'DIRECT' : `VIA ${route.via}`}</span></div>
                <p>{route.segments.map(segment => `${segment.trainNo || 'Train'} ${segment.name || ''} (${segment.from}–${segment.to})`).join('  +  ')}</p>
                {route.interchangeMinutes != null && <small className="buffer">Connection buffer: {Math.floor(route.interchangeMinutes / 60)}h {route.interchangeMinutes % 60}m</small>}
                {route.availability.length === 0 && <div className="classrow"><b>No common class</b><span>Not offered on every leg</span></div>}
                {route.availability.map(item => (
                  <div className="classrow" key={item.class}>
                    <b>{item.class}</b>
                    <span className={item.status === 'OK' && item.results.length ? 'confirmed' : ''}>
                      {item.status === 'OK' ? item.results.length ? `${item.results.length} confirmed option(s)` : 'No fully confirmed option' : item.reason || 'Live availability unavailable'}
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
