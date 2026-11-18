// Provider adapter contract. Connect only an authorised railway-data provider.
// The configured endpoint must return the normalised JSON shape documented in README.md.
export async function getLiveAvailability(segments,journeyDate,travelClass){
 const url=process.env.RAIL_AVAILABILITY_URL,key=process.env.RAIL_API_KEY;
 if(!url||!key)return{status:'UNAVAILABLE',reason:'No authorised live availability provider is configured.'};
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify({segments,journeyDate,travelClass})});
 if(!response.ok)return{status:'UNAVAILABLE',reason:`Provider returned HTTP ${response.status}.`};
 const data=await response.json();if(!Array.isArray(data.results))return{status:'UNAVAILABLE',reason:'Provider response did not match the documented contract.'};
 return{status:'OK',results:data.results,source:data.source||'Configured provider',fetchedAt:data.fetchedAt||new Date().toISOString()};
}
