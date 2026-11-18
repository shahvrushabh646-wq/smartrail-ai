import express from 'express'; import cors from 'cors'; import fs from 'node:fs/promises'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { getLiveAvailability } from './provider.js';
const app=express(), port=Number(process.env.PORT||4100), here=path.dirname(fileURLToPath(import.meta.url));
app.use(cors()); app.use(express.json());
async function trains(){try{return JSON.parse(await fs.readFile(path.join(here,'data/timetable.json'),'utf8'));}catch{return [];}}
app.get('/api/health',(_,res)=>res.json({ok:true,service:'SmartRail AI',liveAvailabilityConfigured:Boolean(process.env.RAIL_AVAILABILITY_URL&&process.env.RAIL_API_KEY)}));
app.post('/api/search',async(req,res)=>{
 const {from,to,date,travelClass='ALL'}=req.body||{};
 if(!from||!to||!date)return res.status(400).json({error:'From, To and journey date are required.'});
 const all=await trains();const norm=s=>String(s||'').trim().toLowerCase();
 const direct=all.filter(t=>norm(t.from)===norm(from)&&norm(t.to)===norm(to));
 const directResults=direct.map(t=>({train:t,segments:[t]}));const connections=[];
 for(const first of all.filter(t=>norm(t.from)===norm(from)))for(const second of all.filter(t=>norm(t.from)===norm(first.to)&&norm(t.to)===norm(to))){
  const a=Number(first.arrivalDayOffset||0)*1440+Number(first.arrivalMinutes),b=Number(second.departureDayOffset||0)*1440+Number(second.departureMinutes);
  if(Number.isFinite(a)&&Number.isFinite(b)&&b-a>=30)connections.push({train:null,segments:[first,second],interchangeMinutes:b-a,via:first.to});
 }
 const results=await Promise.all([...directResults,...connections].map(async c=>{
  const sets=c.segments.map(s=>new Set(s.classes||[]));const common=[...sets[0]].filter(x=>sets.every(set=>set.has(x)));
  const classes=travelClass==='ALL'?common:(common.includes(travelClass)?[travelClass]:[]);
  const availability=await Promise.all(classes.map(async cls=>{const live=await getLiveAvailability(c.segments,date,cls);if(live.status!=='OK')return{class:cls,...live};const confirmed=(live.results||[]).filter(option=>Array.isArray(option.segments)&&option.segments.length===c.segments.length&&option.segments.every(segment=>String(segment.status).toUpperCase()==='CONFIRMED'));return{class:cls,status:'OK',results:confirmed,source:live.source,fetchedAt:live.fetchedAt,excludedCount:(live.results||[]).length-confirmed.length};}));
  return{...c,availability};
 }));
 res.json({from,to,date,results,sourceNote:'Timetable results require a current verified timetable. Seat availability is shown only when an authorised provider is configured.',generatedAt:new Date().toISOString()});
});
app.listen(port,()=>console.log(`SmartRail API listening on ${port}`));
