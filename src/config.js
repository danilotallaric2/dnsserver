const fs = require('fs');
const path = require('path');

function loadConfig(){
  const defaults = {
    HTTP_PORT: 3000,
    DNS_PORT: 53,
    BLOCK_POLICY: 'NXDOMAIN',
    UPSTREAMS: ['1.1.1.1','1.0.0.1','8.8.8.8'],
    LOG_RETENTION_DAYS: 30,
    DB_FILE: 'dnsmon.db',
    DISCORD_WEBHOOK: '',
    ALERT_COOLDOWN_SEC: 300
  };
  const filePath = process.env.CONFIG ? path.resolve(process.env.CONFIG) : path.resolve(process.cwd(), 'config.json');
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}

  const envUpstreams = process.env.UPSTREAMS ? process.env.UPSTREAMS.split(',').map(s=>s.trim()).filter(Boolean) : undefined;
  const cfg = {
    HTTP_PORT: parseInt(process.env.HTTP_PORT || fileCfg.HTTP_PORT || defaults.HTTP_PORT, 10),
    DNS_PORT: parseInt(process.env.DNS_PORT || fileCfg.DNS_PORT || defaults.DNS_PORT, 10),
    BLOCK_POLICY: (process.env.BLOCK_POLICY || fileCfg.BLOCK_POLICY || defaults.BLOCK_POLICY).toUpperCase(),
    UPSTREAMS: envUpstreams || fileCfg.UPSTREAMS || defaults.UPSTREAMS,
    LOG_RETENTION_DAYS: parseInt(process.env.LOG_RETENTION_DAYS || fileCfg.LOG_RETENTION_DAYS || defaults.LOG_RETENTION_DAYS, 10),
    DB_FILE: process.env.DB_FILE || fileCfg.DB_FILE || defaults.DB_FILE,
    DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK || fileCfg.DISCORD_WEBHOOK || defaults.DISCORD_WEBHOOK,
    ALERT_COOLDOWN_SEC: parseInt(process.env.ALERT_COOLDOWN_SEC || fileCfg.ALERT_COOLDOWN_SEC || defaults.ALERT_COOLDOWN_SEC, 10),
  };
  if (!['NXDOMAIN','NULL'].includes(cfg.BLOCK_POLICY)) {
    console.error('BLOCK_POLICY must be NXDOMAIN or NULL'); process.exit(1);
  }
  return cfg;
}

const cfg = loadConfig();
module.exports = { cfg };
