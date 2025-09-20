(function(){
  var host = location.origin;
  document.getElementById('host').textContent = host.replace('http://','').replace('https://','');

  function fetchJSON(url){ return fetch(url).then(function(r){ return r.json(); }); }

  function loadStats(){
    fetchJSON('/api/stats').then(function(s){
      document.getElementById('total').textContent = (s.total||0).toLocaleString();
      document.getElementById('blocked').textContent = (s.blocked||0).toLocaleString();
      var td = (s.topDomains||[]).map(function(d){
        return "<div class=\"row\" style=\"justify-content:space-between\"><span class=\"mono\">" + d.name + "</span><span class=\"muted\">" + d.c + "</span></div>";
      }).join("");
      document.getElementById('topDomains').innerHTML = td;
      var tc = (s.topClients||[]).map(function(d){
        return "<div class=\"row\" style=\"justify-content:space-between\"><span class=\"mono\">" + d.client_ip + "</span><span class=\"muted\">" + d.c + "</span></div>";
      }).join("");
      document.getElementById('topClients').innerHTML = tc;
    });
  }

  function loadLogs(){
    var client = document.getElementById('client').value.trim();
    var search = document.getElementById('search').value.trim();
    var qs = new URLSearchParams({ limit: 200 });
    if (client) qs.set('client', client);
    if (search) qs.set('search', search);
    fetchJSON('/api/logs?' + qs.toString()).then(function(r){
      var tbody = document.getElementById('tbody');
      tbody.innerHTML = '';
      (r.rows||[]).forEach(addRowAtEnd);
    });
  }

  function addRowAtStart(row){ addRow(row, true); }
  function addRowAtEnd(row){ addRow(row, false); }
  function addRow(row, atTop){
    var tr = document.createElement('tr');
    var date = new Date(row.ts);
    var hh = String(date.getHours()).padStart(2,'0');
    var mm = String(date.getMinutes()).padStart(2,'0');
    var ss = String(date.getSeconds()).padStart(2,'0');
    tr.innerHTML = ""
      + "<td class=\"muted\">" + hh + ":" + mm + ":" + ss + "</td>"
      + "<td class=\"mono\">" + row.client_ip + "</td>"
      + "<td class=\"mono\">" + row.name + "</td>"
      + "<td class=\"mono\">" + row.type + "</td>"
      + "<td>" + badgeRc(row) + "</td>"
      + "<td class=\"muted\">" + row.answers + "</td>"
      + "<td class=\"muted\">" + row.duration_ms + "</td>"
      + "<td><button data-dom=\"" + row.name + "\" class=\"blkBtn\">Blacklist</button></td>";
    var tbody = document.getElementById('tbody');
    if (atTop) tbody.prepend(tr); else tbody.appendChild(tr);
    tr.querySelector('.blkBtn').addEventListener('click', function(){ addToBlacklist(row.name); });
  }

  function badgeRc(row){
    if (row.blocked){
      if (row.block_source === 'adguard') return "<span class=\"badge blocked\">AD_BLOCKED</span>";
      return "<span class=\"badge blocked\">BLOCKED</span>";
    }
    if (row.rc === 0) return "<span class=\"badge ok\">NOERROR</span>";
    var map = {1:"FORMERR",2:"SERVFAIL",3:"NXDOMAIN",4:"NOTIMP",5:"REFUSED"};
    return "<span class=\"badge err\">" + (map[row.rc]||row.rc) + "</span>";
  }

  function loadBlacklist(){
    fetchJSON('/api/blacklist').then(function(j){
      var domains = j.domains || [];
      var wrap = document.getElementById('blkList');
      wrap.innerHTML = domains.map(function(d){
        return "<span class=\"pill mono\" style=\"display:inline-flex;align-items:center;gap:8px\">" + d + "<a href=\"#\" data-dom=\"" + d + "\" style=\"color:#ffb3b3;text-decoration:none\">×</a></span>";
      }).join(" ");
      [].slice.call(wrap.querySelectorAll('a')).forEach(function(a){
        a.addEventListener('click', function(e){
          e.preventDefault();
          var d = a.getAttribute('data-dom');
          fetch('/api/blacklist/' + encodeURIComponent(d), { method:'DELETE' }).then(loadBlacklist);
        });
      });
    });
  }

  function addToBlacklist(domain){
    var d = prompt('Bloccare dominio (saranno inclusi anche i sottodomini):', domain || '');
    if (!d) return;
    fetch('/api/blacklist', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({domain:d}) }).then(loadBlacklist);
  }

  var es = new EventSource('/events');
  es.addEventListener('message', function(ev){
    try { var row = JSON.parse(ev.data); } catch(e){ return; }
    var client = document.getElementById('client').value.trim();
    var search = document.getElementById('search').value.trim();
    if (client && row.client_ip !== client) return;
    if (search && row.name.indexOf(search) === -1) return;
    addRowAtStart(row);
  });

  document.getElementById('reload').addEventListener('click', function(){ loadStats(); loadLogs(); });
  document.getElementById('blkAdd').addEventListener('click', function(){ addToBlacklist(document.getElementById('blkInput').value.trim()); });
  loadStats(); loadLogs(); loadBlacklist();
})();
