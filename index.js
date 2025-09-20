const { startDns, stopDns } = require('./src/dnsServer');
const { startWeb, stopWeb } = require('./src/web');
const { cfg } = require('./src/config');
const { db } = require('./src/datastore');
const { refreshLists, schedule: scheduleAdguard } = require('./src/adguard');

// Start services
startDns();
startWeb();
refreshLists().then(r=> console.log('[AdGuard] initial fetch', r)).catch(e=> console.error('[AdGuard] initial fetch error', e && e.message || e));
scheduleAdguard();

function shutdown(sig){
  console.log("\nShutting down (" + sig + ")…");
  try { stopWeb(); } catch(e){}
  try { stopDns(); } catch(e){}
  try { db.close(); } catch(e){}
  setTimeout(function(){ process.exit(0); }, 300).unref();
}
process.on('SIGINT', ()=>shutdown('SIGINT'));
process.on('SIGTERM', ()=>shutdown('SIGTERM'));
