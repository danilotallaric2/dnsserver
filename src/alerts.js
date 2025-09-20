const https = require('https');
const { cfg } = require('./config');

const upstreamHealth = {}; // ip -> { failures, lastNotify }

function sendDiscord(content){
  if (!cfg.DISCORD_WEBHOOK) return;
  try{
    const url = new URL(cfg.DISCORD_WEBHOOK);
    const body = JSON.stringify({ content });
    const opts = { method:'POST', hostname:url.hostname, path:url.pathname + (url.search||''), headers: {'Content-Type':'application/json','Content-Length': Buffer.byteLength(body)} };
    const req = https.request(opts, res => { res.on('data', ()=>{}); });
    req.on('error', ()=>{});
    req.write(body); req.end();
  }catch(_){}
}

function notifyUpstreamIssue(upstream, reason){
  const now = Date.now();
  const st = upstreamHealth[upstream] || (upstreamHealth[upstream] = { failures: 0, lastNotify: 0 });
  st.failures++;
  if (now - st.lastNotify > (cfg.ALERT_COOLDOWN_SEC * 1000)) {
    sendDiscord('⚠️ DNS upstream issue on **' + upstream + '** — ' + reason + ' (failures: ' + st.failures + ')');
    st.lastNotify = now;
  }
}
function markUpstreamOK(upstream){
  const st = upstreamHealth[upstream] || (upstreamHealth[upstream] = { failures: 0, lastNotify: 0 });
  if (st.failures > 0) sendDiscord('✅ DNS upstream recovered: **' + upstream + '**');
  st.failures = 0;
}

module.exports = { notifyUpstreamIssue, markUpstreamOK, sendDiscord };
