const dgram = require('dgram');
const dnsPacket = require('dns-packet');
const { cfg } = require('./config');
const { logRow, classifyBlock } = require('./datastore');
const { notifyUpstreamIssue, markUpstreamOK } = require('./alerts');

const upstreamPort = 53;
const upstreamServers = cfg.UPSTREAMS;

const server4 = dgram.createSocket('udp4');
const server6 = dgram.createSocket('udp6');
const upstreamSock4 = dgram.createSocket('udp4');

let nextUpstreamId = 1;
const pending = new Map(); // key: proto + ':' + id

function rcodeToNum(rc){
  if (typeof rc === 'number') return rc;
  const map = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 };
  return map[String(rc||'').toUpperCase()] ?? 0;
}

function buildBlockedResponse(reqBuf){
  let req; try{ req = dnsPacket.decode(reqBuf); } catch { return null; }
  const q = (req.questions && req.questions[0]) || { name: '.', type:'A' };
  if (cfg.BLOCK_POLICY === 'NXDOMAIN'){
    return dnsPacket.encode({ id: req.id, type:'response', flags:(1<<8)|(1<<7), rcode:'NXDOMAIN', questions:[q], answers:[] });
  } else {
    const answers = [];
    if (q.type === 'A') answers.push({ name:q.name, type:'A', class:'IN', ttl:60, data:'0.0.0.0' });
    if (q.type === 'AAAA') answers.push({ name:q.name, type:'AAAA', class:'IN', ttl:60, data:'::' });
    return dnsPacket.encode({ id:req.id, type:'response', flags:(1<<8)|(1<<7), rcode:'NOERROR', questions:[q], answers });
  }
}

function allocId(){
  for (let i=0;i<65535;i++){
    const id = (nextUpstreamId++ & 0xffff) || 1;
    if (!pending.has('4:'+id) && !pending.has('6:'+id)) return id;
  }
  return Math.floor(Math.random()*65535) || 1;
}

function forwardQuery(reqBuf, clientAddr, clientPort, family){
  let decoded;
  try{ decoded = dnsPacket.decode(reqBuf); } catch { return; }
  const q = (decoded.questions && decoded.questions[0]) || { name:'.', type:'A' };
  const qname = q.name || '.';
  const qtype = q.type || 'A';

  const blk = classifyBlock(qname);
  if (blk.blocked){
    const res = buildBlockedResponse(reqBuf);
    if (res){
      const sock = (family === 'udp6') ? server6 : server4;
      sock.send(res, clientPort, clientAddr);
      logRow({ ts: Date.now(), client_ip: clientAddr, name: qname, type: qtype, rc: (cfg.BLOCK_POLICY==='NXDOMAIN'?3:0), answers: (cfg.BLOCK_POLICY==='NULL'?1:0), blocked:1, duration_ms:0, block_source: blk.source==='list' ? 'adguard' : 'manual' });
    }
    return;
  }

  const start = Date.now();
  const originalId = decoded.id;
  const upstreamId = allocId();
  decoded.id = upstreamId;
  const out = dnsPacket.encode(decoded);
  const key = (family==='udp6'?'6':'4') + ':' + upstreamId;
  const state = { clientAddr, clientPort, originalId, start, qname, qtype, upstreamIndex: 0, family, timer: null };
  pending.set(key, state);

  function trySend(){
    const upstream = upstreamServers[state.upstreamIndex];
    upstreamSock4.send(out, upstreamPort, upstream, function(err){
      if (err){
        notifyUpstreamIssue(upstream, 'SEND_ERROR: ' + (err && err.message ? err.message : 'unknown'));
        state.upstreamIndex++;
        if (state.upstreamIndex < upstreamServers.length){
          trySend();
        } else {
          finish(2, 0, 0, Date.now()-start);
          try {
            const res = dnsPacket.encode({ id: originalId, type:'response', flags:(1<<8)|(1<<7), rcode:'SERVFAIL', questions:[(decoded.questions||[])[0]] });
            const csock = (family==='udp6') ? server6 : server4;
            csock.send(res, clientPort, clientAddr);
          } catch {}
        }
      }
    });
  }

  function finish(rc, answers, blockedFlag, dur){
    pending.delete(key);
    logRow({ ts: Date.now(), client_ip: clientAddr, name: qname, type: qtype, rc, answers, blocked: blockedFlag, duration_ms: Math.max(0, Math.round(dur||0)) });
  }

  state.timer = setTimeout(function(){
    const currentUpstream = upstreamServers[state.upstreamIndex];
    notifyUpstreamIssue(currentUpstream, 'TIMEOUT');
    state.upstreamIndex++;
    if (state.upstreamIndex < upstreamServers.length){
      trySend();
      if (state.timer && typeof state.timer.refresh === 'function') state.timer.refresh();
    } else {
      finish(2, 0, 0, Date.now()-start);
      try {
        const res = dnsPacket.encode({ id: originalId, type:'response', flags:(1<<8)|(1<<7), rcode:'SERVFAIL', questions:[(decoded.questions||[])[0]] });
        const sock2 = (family==='udp6') ? server6 : server4;
        sock2.send(res, clientPort, clientAddr);
      } catch {}
    }
  }, 1500);

  trySend();
}

function handleUpstreamMessage(msg, rinfo, family){
  let res; try { res = dnsPacket.decode(msg); } catch { return; }
  const key = (family==='udp6'?'6':'4') + ':' + res.id;
  const st = pending.get(key);
  if (!st) return;
  clearTimeout(st.timer);
  const rcode = String(res.rcode||'').toUpperCase();
  if (['SERVFAIL','REFUSED','FORMERR','NOTIMP'].includes(rcode)) notifyUpstreamIssue(rinfo.address, 'RCODE:' + rcode); else markUpstreamOK(rinfo.address);
  res.id = st.originalId;
  let buf; try { buf = dnsPacket.encode(res); } catch { return; }
  const sock = (st.family==='udp6') ? server6 : server4;
  sock.send(buf, st.clientPort, st.clientAddr);
  const rcodeNum = rcodeToNum(res.rcode);
  const answers = Array.isArray(res.answers) ? res.answers.length : 0;
  const dur = Date.now() - st.start;
  pending.delete(key);
  logRow({ ts: Date.now(), client_ip: st.clientAddr, name: st.qname, type: st.qtype, rc: rcodeNum, answers, blocked: 0, duration_ms: Math.max(0, dur), block_source:'' });
}

function startDns(){
  server4.on('message', (msg, rinfo) => forwardQuery(msg, rinfo.address, rinfo.port, 'udp4'));
  server6.on('message', (msg, rinfo) => forwardQuery(msg, rinfo.address, rinfo.port, 'udp6'));
  upstreamSock4.on('message', (msg, rinfo) => handleUpstreamMessage(msg, rinfo, 'udp4'));
  server4.on('listening', ()=>console.log('[DNS] UDP4 listening on :' + cfg.DNS_PORT));
  server6.on('listening', ()=>console.log('[DNS] UDP6 listening on :' + cfg.DNS_PORT));
  server4.on('error', (e)=>console.error('[DNS4 error]', e));
  server6.on('error', (e)=>console.error('[DNS6 error]', e));
  upstreamSock4.on('error', (e)=>console.error('[Upstream4 error]', e));
  server4.bind(cfg.DNS_PORT, '0.0.0.0');
  server6.bind(cfg.DNS_PORT, '::');
}
function stopDns(){
  try { server4.close(); } catch {}
  try { server6.close(); } catch {}
  try { upstreamSock4.close(); } catch {}
}

module.exports = { startDns, stopDns };
