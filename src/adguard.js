const https = require('https');
const http = require('http');
const { cfg } = require('./config');
const { addBlacklist, getAllBlacklist, delBlacklist } = require('./datastore');

// In-memory stats & state
let lastFetch = 0;
let lastResult = { loaded: 0, domains: 0, errors: [] };

function fetchUrl(url){
  return new Promise((resolve,reject)=>{
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, res => {
      if (res.statusCode && res.statusCode >= 400){ reject(new Error('HTTP ' + res.statusCode)); return; }
      let data='';
      res.setEncoding('utf8');
      res.on('data', chunk=> data+=chunk);
      res.on('end', ()=> resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, ()=>{ req.destroy(new Error('timeout')); });
  });
}

// Parse AdGuard / hosts style lines into domains
function parseLists(raw){
  const domains = new Set();
  const lines = raw.split(/\r?\n/);
  for (let line of lines){
    line = line.trim();
    if (!line || line.startsWith('!') || line.startsWith('#')) continue; // comments
    // Hosts file style: 0.0.0.0 domain.tld   OR 127.0.0.1 domain
    const hostMatch = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9_.-]+)$/i);
    if (hostMatch){
      const d = normalizeDomain(hostMatch[1]);
      if (d) domains.add(d);
      continue;
    }
    // AdGuard pattern examples: ||example.com^  ||sub.example.net^$important
    if (line.startsWith('||')){
      // Remove leading || and trim at first ^ or $ or / or ?
      let rest = line.slice(2);
      rest = rest.replace(/\^.*$/, '').replace(/[$/].*$/, '');
      const d = normalizeDomain(rest);
      if (d) domains.add(d);
      continue;
    }
    // Plain domain line
    if (/^[a-z0-9_.-]+$/i.test(line) && line.indexOf('.')!==-1){
      const d = normalizeDomain(line);
      if (d) domains.add(d);
      continue;
    }
  }
  return domains;
}

function normalizeDomain(d){
  d = String(d||'').trim().toLowerCase().replace(/\.$/, '');
  if (!d) return '';
  // Strip path/query fragments if any sneaked in
  d = d.split(/[\/#?]/)[0];
  if (!/^[a-z0-9.-]+$/.test(d)) return '';
  if (d.startsWith('.')) d = d.slice(1);
  if (d.split('.').length < 2) return '';
  return d;
}

async function refreshLists(){
  const urls = Array.isArray(cfg.ADGUARD_LIST_URLS) ? cfg.ADGUARD_LIST_URLS : [];
  if (!urls.length){
    lastResult = { loaded:0, domains:0, errors:[] };
    return lastResult;
  }
  const aggregated = new Set();
  const errors = [];
  for (const url of urls){
    try {
      const raw = await fetchUrl(url);
      const subset = parseLists(raw);
      subset.forEach(d => aggregated.add(d));
    } catch(e){
      errors.push(url + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
  // Existing list-derived domains (for pruning)
  const existing = new Set(getAllBlacklist().filter(r => r.source !== 'manual').map(r => r.domain));
  // Add new ones
  aggregated.forEach(d => addBlacklist(d, 'list'));
  // Prune those no longer present
  existing.forEach(d => { if (!aggregated.has(d)) delBlacklist(d); });
  lastFetch = Date.now();
  lastResult = { loaded: urls.length, domains: aggregated.size, errors };
  return lastResult;
}

function schedule(){
  const interval = Math.max(1, cfg.ADGUARD_REFRESH_MIN || 120) * 60000;
  setInterval(()=>{ refreshLists().catch(()=>{}); }, interval).unref();
}

function getAdguardStatus(){
  return { lastFetch, ...lastResult, urls: cfg.ADGUARD_LIST_URLS };
}

module.exports = { refreshLists, schedule, getAdguardStatus };