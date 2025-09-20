const { startDns, stopDns } = require('./src/dnsServer');
const { startWeb, stopWeb } = require('./src/web');
const { cfg } = require('./src/config');
const { db } = require('./src/datastore');

// Start services
startDns();
startWeb();

function shutdown(sig){
  console.log("\nShutting down (" + sig + ")…");
  try { stopWeb(); } catch(e){}
  try { stopDns(); } catch(e){}
  try { db.close(); } catch(e){}
  setTimeout(function(){ process.exit(0); }, 300).unref();
}
process.on('SIGINT', ()=>shutdown('SIGINT'));
process.on('SIGTERM', ()=>shutdown('SIGTERM'));
