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
    duration_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS logs_ts ON logs(ts);
  CREATE INDEX IF NOT EXISTS logs_name ON logs(name);
  CREATE INDEX IF NOT EXISTS logs_client ON logs(client_ip);
  CREATE TABLE IF NOT EXISTS blacklist (
    domain TEXT PRIMARY KEY,
    added_ts INTEGER NOT NULL
  );
`);

const bus = new EventEmitter();

const insLog = db.prepare('INSERT INTO logs (ts, client_ip, name, type, rc, answers, blocked, duration_ms) VALUES (@ts, @client_ip, @name, @type, @rc, @answers, @blocked, @duration_ms)');
function logRow(row){
  try { insLog.run(row); } catch {}
  bus.emit('log', row);
}

const addBlacklistStmt = db.prepare('INSERT OR IGNORE INTO blacklist(domain, added_ts) VALUES(?, ?)');
const delBlacklistStmt = db.prepare('DELETE FROM blacklist WHERE domain = ?');
const getBlacklistStmt = db.prepare('SELECT domain FROM blacklist ORDER BY domain');

let blacklist = new Set(getBlacklistStmt.all().map(r => r.domain.toLowerCase()));

function getBlacklist(){ return Array.from(blacklist).sort(); }
function addBlacklist(domain){
  const d = String(domain||'').toLowerCase().replace(/\.$/, '');
  if (!d || d.indexOf('.')===-1) return false;
  addBlacklistStmt.run(d, Date.now());
  blacklist.add(d);
  return true;
}
function delBlacklist(domain){
  const d = String(domain||'').toLowerCase();
  delBlacklistStmt.run(d);
  blacklist.delete(d);
  return true;
}

function isBlocked(qname){
  const name = String(qname||'').toLowerCase().replace(/\.$/, '');
  if (!name) return false;
  const parts = name.split('.');
  for (let i=0;i<parts.length;i++){
    const suffix = parts.slice(i).join('.');
    if (blacklist.has(suffix)) return true;
  }
  return false;
}

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

module.exports = { db, bus, logRow, isBlocked, getBlacklist, addBlacklist, delBlacklist, stats24h };
