const Database = require('better-sqlite3');
const { cfg } = require('./config');
const EventEmitter = require('events');

const db = new Database(cfg.DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    client_ip TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    rc INTEGER NOT NULL,
    answers INTEGER NOT NULL,
    blocked INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    block_source TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS logs_ts ON logs(ts);
  CREATE INDEX IF NOT EXISTS logs_name ON logs(name);
  CREATE INDEX IF NOT EXISTS logs_client ON logs(client_ip);
  CREATE TABLE IF NOT EXISTS blacklist (
    domain TEXT PRIMARY KEY,
    added_ts INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual'
  );
  CREATE TABLE IF NOT EXISTS allowlist (
    domain TEXT PRIMARY KEY,
    added_ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS allowlist_domain ON allowlist(domain);
`);
// Allowlist management
const addAllowStmt = db.prepare('INSERT OR IGNORE INTO allowlist(domain, added_ts) VALUES(?, ?)');
const delAllowStmt = db.prepare('DELETE FROM allowlist WHERE domain = ?');
const getAllowStmt = db.prepare('SELECT domain FROM allowlist ORDER BY domain');
let allowSet = new Set(getAllowStmt.all().map(r => r.domain.toLowerCase()));
function getAllowlist(){ return Array.from(allowSet).sort(); }
function addAllow(domain){
  const d = String(domain||'').toLowerCase().replace(/\.$/, '');
  if (!d || d.indexOf('.')===-1) return false;
  addAllowStmt.run(d, Date.now());
  allowSet.add(d);
  return true;
}
function delAllow(domain){
  const d = String(domain||'').toLowerCase();
  delAllowStmt.run(d);
  allowSet.delete(d);
  return true;
}

const bus = new EventEmitter();

// Migration attempt for older DBs missing block_source
try { db.prepare("ALTER TABLE logs ADD COLUMN block_source TEXT DEFAULT ''").run(); } catch(e) {}

const insLog = db.prepare('INSERT INTO logs (ts, client_ip, name, type, rc, answers, blocked, duration_ms, block_source) VALUES (@ts, @client_ip, @name, @type, @rc, @answers, @blocked, @duration_ms, @block_source)');
function logRow(row){
  if (!('block_source' in row)) row.block_source = '';
  try { insLog.run(row); } catch {}
  bus.emit('log', row);
}

const addBlacklistStmt = db.prepare('INSERT OR IGNORE INTO blacklist(domain, added_ts, source) VALUES(?, ?, ?)');
const delBlacklistStmt = db.prepare('DELETE FROM blacklist WHERE domain = ?');
const getBlacklistStmt = db.prepare("SELECT domain FROM blacklist WHERE source = 'manual' ORDER BY domain");
const getAllBlacklistStmt = db.prepare('SELECT domain, source FROM blacklist');

// Two sets: manual and auto (from lists)
let manualSet = new Set(getBlacklistStmt.all().map(r => r.domain.toLowerCase()));
let autoSet = new Set(db.prepare("SELECT domain FROM blacklist WHERE source != 'manual'").all().map(r => r.domain.toLowerCase()));

function rebuildSets(){
  manualSet = new Set(getBlacklistStmt.all().map(r => r.domain.toLowerCase()));
  autoSet = new Set(db.prepare("SELECT domain FROM blacklist WHERE source != 'manual'").all().map(r => r.domain.toLowerCase()));
}

function getBlacklist(){ return Array.from(manualSet).sort(); }
function getAllBlacklist(){ return getAllBlacklistStmt.all(); }
function addBlacklist(domain, source='manual'){
  const d = String(domain||'').toLowerCase().replace(/\.$/, '');
  if (!d || d.indexOf('.')===-1) return false;
  addBlacklistStmt.run(d, Date.now(), source==='list'?'list':'manual');
  if (source==='list') autoSet.add(d); else manualSet.add(d);
  return true;
}
function delBlacklist(domain){
  const d = String(domain||'').toLowerCase();
  delBlacklistStmt.run(d);
  manualSet.delete(d); autoSet.delete(d);
  return true;
}

function classifyBlock(qname){
  const name = String(qname||'').toLowerCase().replace(/\.$/, '');
  if (!name) return { blocked:false, source:'' };
  // Allowlist precedence: if any suffix matches allow, we skip blocking
  const parts = name.split('.');
  for (let i=0;i<parts.length;i++){
    const suffix = parts.slice(i).join('.');
    if (allowSet.has(suffix)) return { blocked:false, source:'' };
  }
  for (let i=0;i<parts.length;i++){
    const suffix = parts.slice(i).join('.');
    if (manualSet.has(suffix)) return { blocked:true, source:'manual' };
    if (autoSet.has(suffix)) return { blocked:true, source:'list' };
  }
  return { blocked:false, source:'' };
}
function isBlocked(qname){ return classifyBlock(qname).blocked; }

function stats24h(){
  const now = Date.now();
  const dayAgo = now - 86400000;
  const total = db.prepare('SELECT COUNT(*) c FROM logs WHERE ts >= ?').get(dayAgo).c;
  const blockedC = db.prepare('SELECT COUNT(*) c FROM logs WHERE blocked = 1 AND ts >= ?').get(dayAgo).c;
  const topDomains = db.prepare('SELECT name, COUNT(*) c FROM logs WHERE ts >= ? GROUP BY name ORDER BY c DESC LIMIT 10').all(dayAgo);
  const topClients = db.prepare('SELECT client_ip, COUNT(*) c FROM logs WHERE ts >= ? GROUP BY client_ip ORDER BY c DESC LIMIT 10').all(dayAgo);
  const byMinute = db.prepare('SELECT CAST((ts/60000) AS INTEGER) m, COUNT(*) c FROM logs WHERE ts >= ? GROUP BY m ORDER BY m DESC LIMIT 60').all(now - 60*60000);
  return { total, blocked: blockedC, topDomains, topClients, byMinute };
}

// retention
const retentionMs = cfg.LOG_RETENTION_DAYS * 86400000;
setInterval(()=>{
  const cutoff = Date.now() - retentionMs;
  try { db.prepare('DELETE FROM logs WHERE ts < ?').run(cutoff); } catch {}
}, 6*3600*1000).unref();

module.exports = { db, bus, logRow, isBlocked, classifyBlock, getBlacklist, getAllBlacklist, addBlacklist, delBlacklist, stats24h, getAllowlist, addAllow, delAllow };
