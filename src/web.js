const express = require('express');
const path = require('path');
const { cfg } = require('./config');
const { bus, stats24h, getBlacklist, addBlacklist, delBlacklist, db, getAllowlist, addAllow, delAllow } = require('./datastore');
const { getAdguardStatus, refreshLists } = require('./adguard');

let app, server;
const sseClients = new Set();

function pushEvent(data){
  const payload = 'data: ' + JSON.stringify(data) + '\n\n';
  for (const r of sseClients){ try { r.write(payload); } catch {} }
}
bus.on('log', pushEvent);

function startWeb(){
  app = express();
  app.use(express.json());
  app.use(function(req,res,next){
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // API
  app.get('/api/logs', function(req,res){
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 2000);
    const offset = parseInt(req.query.offset || '0', 10);
    const client = String(req.query.client || '').trim();
    const search = String(req.query.search || '').trim();
    const since = parseInt(req.query.since || '0', 10) || 0;
    const params = [];
    const where = [];
    if (client) { where.push('client_ip = ?'); params.push(client); }
    if (search) { where.push('name LIKE ?'); params.push('%' + search + '%'); }
    if (since) { where.push('ts >= ?'); params.push(since); }
    const sql = 'SELECT * FROM logs ' + (where.length ? ('WHERE ' + where.join(' AND ')) : '') + ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const stmt = db.prepare(sql);
    const rows = stmt.all.apply(stmt, params);
    res.json({ rows });
  });

  app.get('/api/stats', function(req,res){
    res.json(stats24h());
  });

  app.get('/api/blacklist', function(req,res){
    // By default only manual entries; if all=1 requested include all with source flags
    if (String(req.query.all||'')==='1'){
      const { getAllBlacklist } = require('./datastore');
      res.json({ all: getAllBlacklist() });
      return;
    }
    res.json({ domains: getBlacklist() });
  });
  app.post('/api/blacklist', function(req,res){
    const d = String((req.body||{}).domain || '').trim();
    if (!addBlacklist(d)) { res.status(400).json({ error:'Invalid domain' }); return; }
    res.json({ ok:true });
  });
  app.delete('/api/blacklist/:domain', function(req,res){
    delBlacklist(String(req.params.domain||'').trim());
    res.json({ ok:true });
  });

  // Allowlist endpoints
  app.get('/api/allowlist', function(req,res){
    res.json({ domains: getAllowlist() });
  });
  app.post('/api/allowlist', function(req,res){
    const d = String((req.body||{}).domain || '').trim();
    if (!addAllow(d)) { res.status(400).json({ error:'Invalid domain' }); return; }
    res.json({ ok:true });
  });
  app.delete('/api/allowlist/:domain', function(req,res){
    delAllow(String(req.params.domain||'').trim());
    res.json({ ok:true });
  });

  // AdGuard status + manual refresh
  app.get('/api/adguard/status', function(req,res){
    res.json(getAdguardStatus());
  });
  app.post('/api/adguard/refresh', async function(req,res){
    try {
      const r = await refreshLists();
      res.json(r);
    } catch(e){
      res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  });

  // SSE
  app.get('/events', function(req,res){
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write(': ok\n\n');
    sseClients.add(res);
    req.on('close', function(){ sseClients.delete(res); });
  });

  // Static frontend
  app.use('/', express.static(path.join(process.cwd(), 'public')));

  server = app.listen(cfg.HTTP_PORT, function(){
    console.log('[HTTP] Dashboard on http://0.0.0.0:' + cfg.HTTP_PORT);
  });
}

function stopWeb(){
  try { server && server.close(()=>{}); } catch {}
  for (const r of sseClients){ try { r.end(); } catch {} }
}

module.exports = { startWeb, stopWeb };
