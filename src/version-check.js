// Geteilte Auto-Update-Prüfung: erkennt neue Deploys, WÄHREND eine App offen ist.
// Beim Build prägt Vite die Build-Kennung als __BUILD_ID__ ein und legt /version.json daneben.
// Jede App pollt version.json (periodisch + bei Rückkehr in den Vordergrund); weicht die
// Server-Kennung von der geladenen ab, erscheint ein dezenter „Neu laden"-Banner.
// (Ein reiner Reload holt ohnehin die neueste Version — HTML ist no-cache, Assets sind gehasht.)
const BUILD_ID = (typeof __BUILD_ID__ !== 'undefined') ? __BUILD_ID__ : 'dev';

let _shown = false;

async function _serverBuild(){
  try{
    const r = await fetch('/version.json?ts=' + Date.now(), { cache: 'no-store' });
    if(!r.ok) return null;
    const j = await r.json();
    return (j && j.build) || null;
  }catch(_){ return null; }
}

function _banner(onReload){
  if(document.getElementById('vc-update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'vc-update-banner';
  bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:12px;background:#1f2937;color:#fff;padding:10px 14px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);font-family:system-ui,-apple-system,sans-serif;font-size:14px;max-width:92vw;';
  const txt = document.createElement('span'); txt.textContent = 'Neue Version verfügbar';
  const btn = document.createElement('button'); btn.textContent = 'Neu laden';
  btn.style.cssText = 'background:#16a34a;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;';
  btn.onclick = onReload;
  const x = document.createElement('button'); x.setAttribute('aria-label','Schließen'); x.textContent = '✕';
  x.style.cssText = 'background:transparent;color:#cbd5e1;border:none;font-size:15px;cursor:pointer;padding:2px 4px;line-height:1;';
  x.onclick = ()=>{ bar.remove(); _shown = false; };   // später erneut anbieten
  bar.append(txt, btn, x);
  document.body.appendChild(bar);
}

// opts: { intervalMs?, autoReload?, onUpdate?(serverBuild, reload) }
export function initVersionCheck(opts){
  opts = opts || {};
  if(BUILD_ID === 'dev') return;                       // im Dev-Server nicht prüfen
  const intervalMs = opts.intervalMs || 180000;        // 3 Min

  async function check(){
    if(_shown) return;
    const server = await _serverBuild();
    if(!server || server === BUILD_ID) return;
    _shown = true;
    const reload = ()=>{ try{ location.reload(); }catch(_){} };
    if(typeof opts.onUpdate === 'function'){ opts.onUpdate(server, reload); return; }
    if(opts.autoReload){ reload(); return; }
    _banner(reload);
  }

  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) check(); });
  window.addEventListener('focus', check);
  setInterval(check, intervalMs);
  setTimeout(check, 15000);                            // erste Prüfung leicht verzögert
}
