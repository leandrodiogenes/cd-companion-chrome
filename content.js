// Crimson Desert Companion — content script (MAIN world)

(function () {
  'use strict';

  if (window.__cdCompanion) return;
  window.__cdCompanion = true;

  const STORAGE_KEY  = 'cdCompanion_settings';
  const RECONNECT_MS = 3000;

  // ── State ──────────────────────────────────────────────────────────
  let marker            = null;   // mapboxgl.Marker instance
  let mapDestMarker     = null;   // in-game map destination marker
  let mapDestLng        = null;
  let mapDestLat        = null;
  let cachedMap         = null;
  let following         = true;   // auto-pan to player
  let lastPos           = null;   // { lng, lat, x, y, z, realm }
  let lastHeading       = 0;      // degrees, last known movement direction
  let lastCameraHeading = 0;      // degrees, last known camera direction
  let hasCameraHeading  = false;
  let headingSource     = 'auto'; // 'auto'|'entity'|'delta'
  let rotateWithPlayer  = false;
  let rotateWithCamera  = false;
  let wsStatus          = 'disconnected'; // 'connected' | 'disconnected' | 'no-game'
  let _replayingToggle  = false;
  let iconSize          = 1.0;
  let defaultZoom       = 15;
  let centerTeleportY = 1000;
  let autoHideFound = true;
  let autoHideLeftSidebar = false;
  let autoHideRightSidebar = false;
  let waypoints         = [];
  let waypointFilter    = '';
  let hasPreTeleport    = false;
  let teleportEnabled   = true;
  let enforceDefaultZoomUntil = 0;
  let touchPauseActive  = false;
  let touchPauseRestore = false;
  let touchCount        = 0;
  let serverConfig      = { wsHost: 'localhost', wsPort: 7891, wssPort: 7892 };

  // ── Persist settings ───────────────────────────────────────────────
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.following     === 'boolean') following     = s.following;
        if (typeof s.iconSize      === 'number')  iconSize      = s.iconSize;
        if (typeof s.defaultZoom   === 'number')  defaultZoom   = s.defaultZoom;
        if (typeof s.headingSource     === 'string')  headingSource    = s.headingSource;
        if (typeof s.rotateWithPlayer  === 'boolean') rotateWithPlayer = s.rotateWithPlayer;
        if (typeof s.rotateWithCamera  === 'boolean') rotateWithCamera = s.rotateWithCamera;
        if (typeof s.centerTeleportY === 'number') centerTeleportY = s.centerTeleportY;
        if (typeof s.autoHideFound === 'boolean') autoHideFound = s.autoHideFound;
        if (typeof s.autoHideLeftSidebar === 'boolean') autoHideLeftSidebar = s.autoHideLeftSidebar;
        if (typeof s.autoHideRightSidebar === 'boolean') autoHideRightSidebar = s.autoHideRightSidebar;
      }
    } catch (_) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        following,
        iconSize,
        defaultZoom,
        headingSource,
        rotateWithPlayer,
        rotateWithCamera,
        centerTeleportY,
        autoHideFound,
        autoHideLeftSidebar,
        autoHideRightSidebar,
      }));
    } catch (_) {}
  }

  function setIconSize(value) {
    if (!Number.isFinite(value)) return false;
    iconSize = value;
    const input = document.getElementById('cdp-icon-size');
    const label = document.getElementById('cdp-icon-size-val');
    if (input) input.value = iconSize;
    if (label) label.textContent = iconSize.toFixed(1);
    applyIconSize(iconSize);
    saveSettings();
    return true;
  }

  function syncDefaultZoomInputs() {
    ['cdp-default-zoom'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = defaultZoom;
    });
    ['cdp-default-zoom-val'].forEach(id => {
      const label = document.getElementById(id);
      if (label) label.textContent = defaultZoom.toFixed(1);
    });
  }

  function setDefaultZoom(value, applyNow = true) {
    if (!Number.isFinite(value)) return false;
    defaultZoom = Math.max(0, Math.min(24, value));
    syncDefaultZoomInputs();
    saveSettings();
    const map = getMap();
    if (applyNow && map && typeof map.zoomTo === 'function') {
      map.zoomTo(defaultZoom);
    }
    return true;
  }

  function setAutoHideSetting(key, value) {
    if (key === 'found') autoHideFound = !!value;
    else if (key === 'left') autoHideLeftSidebar = !!value;
    else if (key === 'right') autoHideRightSidebar = !!value;
    else return false;

    const ids = {
      found: 'cdp-auto-hide-found',
      left: 'cdp-auto-hide-left',
      right: 'cdp-auto-hide-right',
    };
    const input = document.getElementById(ids[key]);
    if (input) input.checked = !!value;
    saveSettings();
    if (value) applyAutoHideSettings();
    return true;
  }

  function syncCenterTeleportInputs() {
    ['cdp-center-y', 'cdp-center-panel-y'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = centerTeleportY;
    });
    ['cdp-center-y-val', 'cdp-center-panel-y-val'].forEach(id => {
      const label = document.getElementById(id);
      if (label) label.textContent = Math.round(centerTeleportY).toString();
    });
  }

  function setServerConfigInputs(cfg) {
    serverConfig = cfg;
    const hostEl = document.getElementById('cdp-ws-host');
    const portEl = document.getElementById('cdp-ws-port');
    const sslEl  = document.getElementById('cdp-wss-port');
    if (hostEl && document.activeElement !== hostEl) hostEl.value = cfg.wsHost;
    if (portEl && document.activeElement !== portEl) portEl.value = cfg.wsPort;
    if (sslEl  && document.activeElement !== sslEl)  sslEl.value  = cfg.wssPort;
  }

  function setCenterTeleportY(value) {
    if (!Number.isFinite(value)) return false;
    centerTeleportY = value;
    syncCenterTeleportInputs();
    saveSettings();
    return true;
  }

  // ── Apply map settings ─────────────────────────────────────────────
  function applyIconSize(size) {
    if (window.mapManager && typeof window.mapManager.setIconSize === 'function')
      window.mapManager.setIconSize(size);
  }

  function waitForMapManager() {
    if (window.mapManager && typeof window.mapManager.setIconSize === 'function') {
      applyIconSize(iconSize); return;
    }
    const iv = setInterval(() => {
      if (window.mapManager && typeof window.mapManager.setIconSize === 'function') {
        clearInterval(iv); applyIconSize(iconSize);
      }
    }, 500);
    setTimeout(() => clearInterval(iv), 60000);
  }

  // ── Map discovery ──────────────────────────────────────────────────
  function getMap() {
    if (cachedMap) return cachedMap;
    if (window.map && typeof window.map.easeTo === 'function') {
      cachedMap = window.map;
      installTouchFollowPause(cachedMap);
    }
    return cachedMap;
  }

  function installTouchFollowPause(map) {
    const canvas = map && typeof map.getCanvas === 'function' ? map.getCanvas() : null;
    if (!canvas || canvas.__cdpTouchFollowPause) return;
    canvas.__cdpTouchFollowPause = true;
    canvas.addEventListener('touchstart', onMapTouchStart, { passive: true });
    canvas.addEventListener('touchend', onMapTouchEnd, { passive: true });
    canvas.addEventListener('touchcancel', onMapTouchEnd, { passive: true });
  }

  function onMapTouchStart(e) {
    touchCount = e.touches ? e.touches.length : 1;
    if (touchPauseActive) return;
    touchPauseRestore = following;
    if (!following) return;
    touchPauseActive = true;
    following = false;
    updateOverlay();
    updateArrowRotation();
    resetMapBearing(0);
  }

  function onMapTouchEnd(e) {
    touchCount = e.touches ? e.touches.length : 0;
    if (touchCount > 0 || !touchPauseActive) return;
    touchPauseActive = false;
    const shouldRestore = touchPauseRestore;
    touchPauseRestore = false;
    if (!shouldRestore) return;
    following = true;
    updateOverlay();
    updateArrowRotation();
    if (lastPos) panToPlayer(lastPos.lng, lastPos.lat);
  }

  function waitForMap() {
    const applyInitialZoom = (map) => {
      enforceDefaultZoomUntil = Date.now() + 4000;
      map.zoomTo(defaultZoom);
    };
    if (getMap()) { applyInitialZoom(getMap()); return; }
    const iv = setInterval(() => {
      const map = getMap();
      if (map) { clearInterval(iv); applyInitialZoom(map); }
    }, 500);
    setTimeout(() => clearInterval(iv), 60000);
  }

  function waitForElement(selector, callback, timeout = 15000) {
    const el = document.querySelector(selector);
    if (el) { callback(el); return; }
    const iv = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) { clearInterval(iv); callback(el); }
    }, 300);
    setTimeout(() => clearInterval(iv), timeout);
  }

  function applyAutoHideSettings() {
    if (autoHideFound) {
      waitForElement('#toggle-found', (btn) => {
        if (!btn.classList.contains('disabled')) btn.click();
      });
    }
    if (autoHideLeftSidebar) {
      waitForElement('.sidebar-close .left-arrow, .sidebar-close', (btn) => btn.click());
    }
    if (autoHideRightSidebar) {
      waitForElement('#right-sidebar .sidebar-close', (btn) => btn.click());
    }
  }

  // ── In-game map destination marker ────────────────────────────────
  function ensureMapDestMarker() {
    const map = getMap();
    if (!map || mapDestMarker) return;
    const el = document.createElement('div');
    el.id = 'cdp-map-dest-marker';
    el.style.cursor = 'pointer';
    el.innerHTML = `
      <img src="https://raw.githubusercontent.com/leandrodiogenes/cd-companion/main/mark.png"
        style="width:32px;height:32px;filter:drop-shadow(0 0 4px rgba(255,80,80,.9));display:block;">
    `;
    el.style.display = 'none';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showMapDestPopup(el);
    });
    mapDestMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([0, 0])
      .addTo(map);
  }

  function showMapDestPopup(anchorEl) {
    let popup = document.getElementById('cdp-map-dest-popup');
    if (popup) { popup.remove(); return; }
    popup = document.createElement('div');
    popup.id = 'cdp-map-dest-popup';
    const rect = anchorEl.getBoundingClientRect();
    popup.style.cssText = `
      position:fixed;z-index:99999;
      left:${rect.left + rect.width / 2}px;
      top:${rect.top - 8}px;
      transform:translate(-50%, -100%);
      background:rgba(12,12,18,.95);
      border:1px solid rgba(255,80,80,.45);
      border-radius:6px;padding:6px 10px;
      box-shadow:0 3px 12px rgba(0,0,0,.5);
      display:flex;flex-direction:column;align-items:center;gap:6px;
      font:12px 'Segoe UI',system-ui,sans-serif;color:#e8e8e8;
      white-space:nowrap;
    `;
    popup.innerHTML = `
      <span style="font-size:11px;color:#aaa">Map Marker</span>
      <button id="cdp-map-dest-tp"
        style="background:rgba(255,80,80,.2);border:1px solid rgba(255,80,80,.5);
        color:#ff6666;font:11px 'Segoe UI';padding:3px 10px;border-radius:4px;cursor:pointer">
        📍 Teleport here
      </button>
    `;
    document.body.appendChild(popup);
    popup.querySelector('#cdp-map-dest-tp').addEventListener('click', () => {
      sendCmd({ cmd: 'teleport_marker' });
      popup.remove();
    });
    const close = (e) => { if (!popup.contains(e.target) && e.target !== anchorEl) { popup.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  // ── Off-screen map destination indicator ──────────────────────────
  function ensureEdgeIndicator() {
    if (document.getElementById('cdp-edge-indicator')) return;
    const el = document.createElement('div');
    el.id = 'cdp-edge-indicator';
    el.style.cssText = `
      position:fixed;z-index:9000;width:28px;height:28px;
      pointer-events:none;display:none;
      transform-origin:center center;
    `;
    el.innerHTML = `
      <img src="https://raw.githubusercontent.com/leandrodiogenes/cd-companion/main/mark.png"
        style="width:28px;height:28px;filter:drop-shadow(0 0 4px rgba(255,80,80,.9));display:block;">
    `;
    document.body.appendChild(el);
  }

  function updateEdgeIndicator() {
    const map = getMap();
    const el = document.getElementById('cdp-edge-indicator');
    if (!el || mapDestLng === null || mapDestLat === null) return;

    const container = map.getContainer();
    const rect = container.getBoundingClientRect();
    const pt = map.project([mapDestLng, mapDestLat]);

    const pad = 36;
    const inView = pt.x >= pad && pt.x <= rect.width - pad &&
                   pt.y >= pad && pt.y <= rect.height - pad;

    if (inView) {
      el.style.display = 'none';
      return;
    }

    el.style.display = 'block';

    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const angle = Math.atan2(pt.y - cy, pt.x - cx);

    // Clamp to edge
    const hw = rect.width / 2 - pad;
    const hh = rect.height / 2 - pad;
    const tx = Math.cos(angle);
    const ty = Math.sin(angle);
    const scale = Math.min(Math.abs(hw / (tx || 1e-9)), Math.abs(hh / (ty || 1e-9)));
    const ex = rect.left + cx + tx * scale;
    const ey = rect.top + cy + ty * scale;

    el.style.left = (ex - 14) + 'px';
    el.style.top  = (ey - 14) + 'px';
  }

  function installEdgeIndicatorListener() {
    const map = getMap();
    if (!map || map.__cdpEdgeListener) return;
    map.__cdpEdgeListener = true;
    map.on('move', updateEdgeIndicator);
    map.on('zoom', updateEdgeIndicator);
  }

  // ── Player marker ──────────────────────────────────────────────────
  function ensureMarker() {
    const map = getMap();
    if (!map || marker) return;

    const el = document.createElement('div');
    el.id = 'cdp-marker';
    el.innerHTML = `
      <svg class="cdp-arrow" viewBox="-12 -12 24 24" xmlns="http://www.w3.org/2000/svg">
        <polygon points="0,-10 7,6 0,2 -7,6" fill="#ffd060" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
      <div class="cdp-pulse"></div>
    `;

    marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([0, 0])
      .addTo(map);
  }

  function updateMarker(lng, lat) {
    ensureMarker();
    if (marker) marker.setLngLat([lng, lat]);
  }

  function updateHeading(newPos) {
    let deg = null;
    // 'entity' ou 'auto': usa msg.heading se disponível
    if (headingSource !== 'delta' && typeof newPos.heading === 'number') {
      deg = newPos.heading;
    } else if (headingSource !== 'entity') {
      // 'delta' ou 'auto' sem heading: calcula via delta de posição
      if (!lastPos) return;
      const dx = newPos.x - lastPos.x;
      const dz = newPos.z - lastPos.z;
      if (dx * dx + dz * dz < 0.001) return;
      deg = Math.atan2(dx, dz) * 180 / Math.PI;
    }
    if (deg === null) return;
    lastHeading = deg;
    updateArrowRotation();
  }

  function getMapBearing() {
    if (!following) return 0;
    if (rotateWithCamera) return lastCameraHeading;
    if (rotateWithPlayer) return lastHeading;
    return 0;
  }

  function resetMapBearing(duration = 300) {
    const map = getMap();
    if (map) map.easeTo({ bearing: 0, duration });
  }

  function updateArrowRotation() {
    const arrow = document.querySelector('.cdp-arrow');
    if (arrow) {
      const arrowDeg = following && rotateWithCamera
        ? lastHeading - lastCameraHeading
        : (following && rotateWithPlayer ? 0 : lastHeading);
      arrow.style.transform = `translate(-50%, -50%) rotate(${arrowDeg}deg)`;
    }
  }

  function setRotateWithPlayer(val) {
    rotateWithPlayer = !!val;
    if (rotateWithPlayer) rotateWithCamera = false;
    saveSettings();
    const cb = document.getElementById('cdp-rotate-map');
    if (cb) cb.checked = rotateWithPlayer;
    const camCb = document.getElementById('cdp-rotate-camera');
    if (camCb) camCb.checked = rotateWithCamera;
    updateArrowRotation();
    if (!following || (!rotateWithPlayer && !rotateWithCamera)) resetMapBearing();
  }

  function setRotateWithCamera(val) {
    rotateWithCamera = !!val;
    if (rotateWithCamera) rotateWithPlayer = false;
    saveSettings();
    const cb = document.getElementById('cdp-rotate-camera');
    if (cb) cb.checked = rotateWithCamera;
    const playerCb = document.getElementById('cdp-rotate-map');
    if (playerCb) playerCb.checked = rotateWithPlayer;
    updateArrowRotation();
    if (!following || (!rotateWithCamera && !rotateWithPlayer)) resetMapBearing();
  }

  function isSamePositionMessage(pos, prev) {
    if (!prev) return false;
    return pos.lng === prev.lng &&
      pos.lat === prev.lat &&
      pos.x === prev.x &&
      pos.y === prev.y &&
      pos.z === prev.z &&
      pos.realm === prev.realm &&
      pos.heading === prev.heading;
  }

  function onCameraHeading(msg) {
    if (typeof msg.heading !== 'number') return;
    if (hasCameraHeading && msg.heading === lastCameraHeading) return;
    hasCameraHeading = true;
    lastCameraHeading = msg.heading;
    if (!rotateWithCamera || !following) {
      updateArrowRotation();
      return;
    }
    updateArrowRotation();
    const mm = getMap();
    if (!mm) return;
    const view = {
      bearing: lastCameraHeading,
      duration: 100,
    };
    if (Date.now() < enforceDefaultZoomUntil) view.zoom = defaultZoom;
    if (following && lastPos) {
      view.center = [lastPos.lng, lastPos.lat];
      mm.easeTo(view);
    } else {
      mm.easeTo(view);
    }
  }

  // ── Map pan ────────────────────────────────────────────────────────
  function panToPlayer(lng, lat) {
    const map = getMap();
    if (!map) return;
    const view = { center: [lng, lat], duration: 50 };
    if (Date.now() < enforceDefaultZoomUntil) view.zoom = defaultZoom;
    map.easeTo(view);
  }

  function createCenterCrosshair() {
    let el = document.getElementById('cdp-center-crosshair');
    if (el) {
      updateCenterCrosshairViewport();
      return;
    }
    el = document.createElement('div');
    el.id = 'cdp-center-crosshair';
    document.body.appendChild(el);
    updateCenterCrosshairViewport();
    window.addEventListener('resize', updateCenterCrosshairViewport);
    window.addEventListener('orientationchange', updateCenterCrosshairViewport);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateCenterCrosshairViewport);
      window.visualViewport.addEventListener('scroll', updateCenterCrosshairViewport);
    }
  }

  function updateCenterCrosshairViewport() {
    const el = document.getElementById('cdp-center-crosshair');
    if (!el) return;
    const vv = window.visualViewport;
    const cx = vv ? vv.offsetLeft + vv.width / 2 : window.innerWidth / 2;
    const cy = vv ? vv.offsetTop + vv.height / 2 : window.innerHeight / 2;
    el.style.setProperty('--cdp-crosshair-x', `${cx}px`);
    el.style.setProperty('--cdp-crosshair-y', `${cy}px`);
  }

  // ── Position update ────────────────────────────────────────────────
  function onPosition(pos) {
    if (isSamePositionMessage(pos, lastPos)) return;
    updateHeading(pos);
    lastPos = pos;
    updateMarker(pos.lng, pos.lat);
    const mm = window.mapManager && window.mapManager.map;
    if (rotateWithCamera) {
      if (following) panToPlayer(pos.lng, pos.lat);
    } else if (following && rotateWithPlayer && mm) {
      const view = { center: [pos.lng, pos.lat], bearing: lastHeading, duration: 150 };
      if (Date.now() < enforceDefaultZoomUntil) view.zoom = defaultZoom;
      mm.easeTo(view);
    } else if (following) {
      panToPlayer(pos.lng, pos.lat);
    }
    updateOverlay();
  }

  // ── Bridge via postMessage (bridge.js faz a ponte com o background) ──
  function sendCmd(obj) {
    window.postMessage({ __cdpFrom: 'content', payload: obj }, '*');
  }

  // ── MapGenie location sync ─────────────────────────────────────────
  (function _patchRequests() {
    const _origFetch = window.fetch;
    window.fetch = async function (...args) {
      const res = await _origFetch.apply(this, args);
      if (!_replayingToggle && res.ok) {
        try {
          const url = typeof args[0] === 'string' ? args[0]
            : (args[0] instanceof Request ? args[0].url : '');
          const method = ((args[1] && args[1].method) ||
            (args[0] instanceof Request ? args[0].method : 'GET')).toUpperCase();
          const parts = url.split('/api/v1/user/locations/');
          if (parts.length > 1 && (method === 'PUT' || method === 'DELETE')) {
            const locationId = parts[1].split('/')[0].split('?')[0];
            if (locationId) sendCmd({ cmd: 'location_toggle', locationId, found: method === 'PUT' });
          }
        } catch (_) {}
      }
      return res;
    };

    const _origOpen = XMLHttpRequest.prototype.open;
    const _origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._cdMethod = method ? method.toUpperCase() : 'GET';
      this._cdUrl    = typeof url === 'string' ? url : String(url);
      return _origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      const xhr = this;
      xhr.addEventListener('load', function () {
        if (_replayingToggle) return;
        if (xhr.status < 200 || xhr.status >= 300) return;
        const parts = (xhr._cdUrl || '').split('/api/v1/user/locations/');
        if (parts.length > 1 && (xhr._cdMethod === 'PUT' || xhr._cdMethod === 'DELETE')) {
          const locationId = parts[1].split('/')[0].split('?')[0];
          if (locationId) sendCmd({ cmd: 'location_toggle', locationId, found: xhr._cdMethod === 'PUT' });
        }
      });
      return _origSend.apply(this, args);
    };
  })();

  function _showLocationToast(locationId, found) {
    let toast = document.getElementById('cdp-location-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cdp-location-toast';
      toast.style.cssText = [
        'position:fixed', 'bottom:70px', 'right:12px', 'z-index:99999',
        'background:rgba(12,12,18,.93)', 'color:#e8e8e8',
        "font:12px/1.5 'Segoe UI',system-ui,sans-serif",
        'border:1px solid rgba(255,208,96,.45)', 'border-radius:6px',
        'padding:6px 14px', 'pointer-events:none',
        'box-shadow:0 3px 12px rgba(0,0,0,.5)',
        'transition:opacity .3s', 'opacity:0', 'white-space:nowrap',
      ].join(';');
      document.body.appendChild(toast);
    }
    const action = found ? 'marcado' : 'desmarcado';
    toast.textContent = `Location #${locationId} ${action} em outro cliente`;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
  }

  function _onLocationToggle(locationId, found) {
    _showLocationToast(locationId, found);
    if (typeof window.mapManager?.markLocationAsFound === 'function') {
      _replayingToggle = true;
      window.mapManager.markLocationAsFound(parseInt(locationId, 10), found);
      setTimeout(() => { _replayingToggle = false; }, 2000);
    }
  }

  // ── Waypoints ──────────────────────────────────────────────────────
  function ensureWpToggleBtn() {
    if (document.getElementById('cdp-wp-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'cdp-wp-toggle';
    btn.title = 'Waypoints';
    btn.textContent = '⭕';
    btn.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:10000;' +
      'width:36px;height:36px;border-radius:50%;' +
      'background:rgba(12,12,18,.9);border:1px solid rgba(255,208,96,.35);' +
      'color:#ffd060;font:16px "Segoe UI";cursor:pointer;' +
      'box-shadow:0 3px 12px rgba(0,0,0,.5);' +
      'display:flex;align-items:center;justify-content:center;' +
      'backdrop-filter:blur(4px);transition:border-color .15s,background .15s';
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,208,96,.18)';
      btn.style.borderColor = 'rgba(255,208,96,.7)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(12,12,18,.9)';
      btn.style.borderColor = 'rgba(255,208,96,.35)';
    });
    btn.addEventListener('click', () => {
      const panel = document.getElementById('cdp-wp-panel');
      if (!panel) { ensureWaypointPanel(); return; }
      const visible = panel.style.display !== 'none';
      panel.style.display = visible ? 'none' : 'flex';
    });
    document.body.appendChild(btn);
  }

  function teleportMapCenter() {
    const map = getMap();
    if (!map || typeof map.getCenter !== 'function') return;
    const center = map.getCenter();
    hasPreTeleport = true;
    sendCmd({
      cmd: 'teleport_map',
      lng: center.lng,
      lat: center.lat,
      y: centerTeleportY,
      realm: lastPos ? lastPos.realm : 'pywel',
    });
  }

  function ensureCenterTeleportBtn() {
    if (document.getElementById('cdp-center-tp')) return;
    const btn = document.createElement('button');
    btn.id = 'cdp-center-tp';
    btn.title = 'Abrir teleporte para o centro da tela';
    btn.textContent = '◎';
    btn.style.cssText = 'position:fixed;bottom:12px;left:56px;z-index:10000;' +
      'width:36px;height:36px;border-radius:50%;' +
      'background:rgba(12,12,18,.9);border:1px solid rgba(100,160,255,.4);' +
      'color:#80b4ff;font:18px "Segoe UI";cursor:pointer;' +
      'box-shadow:0 3px 12px rgba(0,0,0,.5);' +
      'display:flex;align-items:center;justify-content:center;' +
      'backdrop-filter:blur(4px);transition:border-color .15s,background .15s';
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(100,160,255,.18)';
      btn.style.borderColor = 'rgba(100,160,255,.75)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(12,12,18,.9)';
      btn.style.borderColor = 'rgba(100,160,255,.4)';
    });
    btn.addEventListener('click', () => {
      const panel = document.getElementById('cdp-center-tp-panel');
      if (!panel) { ensureCenterTeleportPanel(); return; }
      const visible = panel.style.display !== 'none';
      panel.style.display = visible ? 'none' : 'flex';
    });
    document.body.appendChild(btn);
  }

  function ensureCenterTeleportPanel() {
    if (document.getElementById('cdp-center-tp-panel')) return;
    const el = document.createElement('div');
    el.id = 'cdp-center-tp-panel';
    el.style.cssText = 'position:fixed;bottom:56px;left:56px;z-index:9999;' +
      'background:rgba(12,12,18,.92);color:#e8e8e8;' +
      "font:12px/1.5 'Segoe UI',system-ui,sans-serif;" +
      'border:1px solid rgba(100,160,255,.3);border-radius:7px;' +
      'padding:8px 10px;width:210px;backdrop-filter:blur(5px);' +
      'box-shadow:0 4px 18px rgba(0,0,0,.5);display:none;' +
      'flex-direction:column;gap:7px;overflow:hidden';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="color:#80b4ff;font-weight:600;flex:1;font-size:12px">Centro da tela</span>
      </div>
      <div style="display:flex;align-items:center;gap:7px">
        <span style="color:#bbb;font-size:11px;white-space:nowrap">Y <span id="cdp-center-panel-y-val">${Math.round(centerTeleportY)}</span></span>
        <input type="range" id="cdp-center-panel-y" min="-5000" max="5000" step="10"
          value="${centerTeleportY}">
      </div>
      <button id="cdp-center-panel-tp" title="Teleportar para o centro da tela"
        style="background:rgba(100,160,255,.14);border:1px solid rgba(100,160,255,.45);
        color:#80b4ff;font:11px 'Segoe UI';padding:4px 8px;border-radius:4px;
        cursor:pointer;width:100%">
        Teleportar
      </button>
    `;
    document.body.appendChild(el);

    document.getElementById('cdp-center-panel-y').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      if (!setCenterTeleportY(value)) e.target.value = centerTeleportY;
    });
    document.getElementById('cdp-center-panel-tp').addEventListener('click', teleportMapCenter);
  }

  function ensureWaypointPanel() {
    if (document.getElementById('cdp-wp-panel')) return;
    const el = document.createElement('div');
    el.id = 'cdp-wp-panel';
    el.style.cssText = 'position:fixed;bottom:56px;left:12px;z-index:9999;' +
      'background:rgba(12,12,18,.92);color:#e8e8e8;' +
      "font:12px/1.5 'Segoe UI',system-ui,sans-serif;" +
      'border:1px solid rgba(255,208,96,.25);border-radius:7px;' +
      'padding:8px 10px;width:224px;max-height:520px;' +
      'backdrop-filter:blur(5px);box-shadow:0 4px 18px rgba(0,0,0,.5);' +
      'display:none;flex-direction:column;gap:5px;overflow:hidden';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="color:#ffd060;font-weight:600;flex:1;font-size:12px">⭕ Waypoints</span>
        <button id="cdp-wp-save" title="Salvar posição atual"
          style="background:rgba(255,208,96,.15);border:1px solid rgba(255,208,96,.4);
          color:#ffd060;font:11px 'Segoe UI';padding:2px 8px;border-radius:4px;cursor:pointer">
          + Salvar
        </button>
      </div>
      <input id="cdp-wp-filter" placeholder="Filtrar waypoints"
        style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
        color:#e8e8e8;font:11px 'Segoe UI';padding:4px 7px;border-radius:4px;outline:none">
      <div id="cdp-wp-list" style="overflow-y:auto;max-height:170px;display:flex;
        flex-direction:column;gap:3px;flex-shrink:0"></div>
    `;
    document.body.appendChild(el);

    document.getElementById('cdp-wp-filter').addEventListener('input', (e) => setWaypointFilter(e.target.value));
    document.getElementById('cdp-wp-save').addEventListener('click', () => {
      const name = prompt('Nome do waypoint:', lastPos
        ? `${lastPos.realm === 'abyss' ? '[Abyss] ' : ''}${Math.round(lastPos.x)}, ${Math.round(lastPos.z)}`
        : 'Waypoint');
      if (name !== null) sendCmd({ cmd: 'save_waypoint', name });
    });
  }

  function setWaypointFilter(value) {
    waypointFilter = (value || '').trim().toLowerCase();
    const input = document.getElementById('cdp-wp-filter');
    if (input && input.value !== (value || '')) input.value = value || '';
    renderWaypoints();
  }

  function matchesWaypointFilter(wp) {
    if (!waypointFilter) return true;
    const text = [
      wp.name,
      wp.realm,
      wp.absX, wp.absY, wp.absZ,
      wp.x, wp.y, wp.z,
    ].filter(v => v !== undefined && v !== null).join(' ').toLowerCase();
    return text.includes(waypointFilter);
  }

  function renderWaypoints() {
    ensureWaypointPanel();
    const list = document.getElementById('cdp-wp-list');
    if (!list) return;
    if (waypoints.length === 0) {
      list.innerHTML = '<div style="color:#555;font-size:11px;text-align:center;padding:4px 0">Nenhum waypoint salvo</div>';
      return;
    }
    const items = waypoints
      .map((wp, i) => ({ wp, i }))
      .filter(item => matchesWaypointFilter(item.wp));
    if (items.length === 0) {
      list.innerHTML = '<div style="color:#555;font-size:11px;text-align:center;padding:4px 0">Nenhum waypoint encontrado</div>';
      return;
    }
    list.innerHTML = items.map(({ wp, i }) => `
      <div style="display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.04);
        border-radius:4px;padding:3px 6px;">
        <span style="flex:1;font-size:11px;white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;color:#ccc" title="${wp.name}">${wp.name}</span>
        <button data-tp="${i}" title="Teleportar"
          style="background:rgba(255,208,96,.15);border:1px solid rgba(255,208,96,.35);
          color:#ffd060;font:10px 'Segoe UI';padding:1px 5px;border-radius:3px;
          cursor:pointer;flex-shrink:0">⭕</button>
        <button data-del="${i}" title="Remover"
          style="background:transparent;border:none;color:#555;font:12px monospace;
          cursor:pointer;padding:0 2px;flex-shrink:0">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-tp]').forEach(btn => {
      btn.addEventListener('click', () => {
        const wp = waypoints[+btn.dataset.tp];
        if (wp) {
          hasPreTeleport = true;
          sendCmd({ cmd: 'teleport', x: wp.absX, y: wp.absY, z: wp.absZ });
        }
      });
    });
    list.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        sendCmd({ cmd: 'delete_waypoint', index: +btn.dataset.del });
      });
    });
  }

  function connect() {
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.__cdpFrom !== 'background') return;
      const msg = e.data.payload;
      if (msg.type === 'status') {
        wsStatus = msg.connected ? 'connected' : 'disconnected';
        updateOverlay();
        return;
      }
      if (msg.type === 'engine_status') {
        if (typeof msg.teleportEnabled === 'boolean') {
          teleportEnabled = msg.teleportEnabled;
          updateTeleportVisibility();
        }
        return;
      }
      if (msg.type === 'location_toggle') {
        _onLocationToggle(msg.locationId, msg.found);
        return;
      }
      if (msg.type === 'server_config') {
        setServerConfigInputs(msg);
        return;
      }
      if (msg.type === 'camera_heading') {
        onCameraHeading(msg);
        return;
      }
      if (msg.type === 'waypoints') {
        waypoints = msg.data || [];
        renderWaypoints();
        return;
      }
      if (msg.type === 'teleport_map_result') {
        if (!msg.ok) hasPreTeleport = false;
        updateOverlay();
        return;
      }
      if (msg.type === 'map_marker') {
        mapDestLng = msg.lng;
        mapDestLat = msg.lat;
        ensureMapDestMarker();
        ensureEdgeIndicator();
        installEdgeIndicatorListener();
        if (mapDestMarker) {
          mapDestMarker.setLngLat([msg.lng, msg.lat]);
          mapDestMarker.getElement().style.display = '';
        }
        updateEdgeIndicator();
        return;
      }
      if (msg.type === 'map_marker_cleared') {
        mapDestLng = null;
        mapDestLat = null;
        if (mapDestMarker) mapDestMarker.getElement().style.display = 'none';
        const ei = document.getElementById('cdp-edge-indicator');
        if (ei) ei.style.display = 'none';
        return;
      }
      if (typeof msg.lng === 'number' && typeof msg.lat === 'number') {
        onPosition(msg);
      }
    });
    window.postMessage({ __cdpFrom: 'content', __cdpReady: true }, '*');
  }

  // ── Overlay UI ─────────────────────────────────────────────────────
  function createOverlay() {
    if (document.getElementById('cdp-overlay')) return;

    const el = document.createElement('div');
    el.id = 'cdp-overlay';
    el.innerHTML = `
      <div id="cdp-header">
        <span id="cdp-icon">🗺</span>
        <span id="cdp-title">CD Companion</span>
        <button id="cdp-follow-btn" title="Toggle follow mode">Follow: ON</button>
        <button id="cdp-settings-btn" title="Settings">⚙</button>
      </div>
      <div id="cdp-coords">--</div>
      <div id="cdp-status">Connecting…</div>
      <div id="cdp-settings-panel">
        <div class="cdp-setting-row">
          <span class="cdp-setting-label">Ícones <span id="cdp-icon-size-val">${iconSize.toFixed(1)}</span></span>
          <input type="range" id="cdp-icon-size" min="0.3" max="1.5" step="0.1" value="${iconSize}">
        </div>
        <div class="cdp-setting-row">
          <span class="cdp-setting-label">Zoom inicial <span id="cdp-default-zoom-val">${defaultZoom.toFixed(1)}</span></span>
          <input type="range" id="cdp-default-zoom" min="0" max="24" step="0.5" value="${defaultZoom}">
        </div>
        <label class="cdp-setting-check">
          <span>Girar mapa com player</span>
          <input type="checkbox" id="cdp-rotate-map" ${rotateWithPlayer ? 'checked' : ''}>
        </label>
        <label class="cdp-setting-check">
          <span>Girar mapa com câmera</span>
          <input type="checkbox" id="cdp-rotate-camera" ${rotateWithCamera ? 'checked' : ''}>
        </label>
        <div class="cdp-setting-row">
          <span class="cdp-setting-label">Seta de direção</span>
          <select id="cdp-heading-src" class="cdp-select">
            <option value="auto">Auto</option>
            <option value="entity">Entity vector</option>
            <option value="delta">Delta posição</option>
          </select>
        </div>
        <label class="cdp-setting-check">
          <span>Ocultar encontrados</span>
          <input type="checkbox" id="cdp-auto-hide-found" ${autoHideFound ? 'checked' : ''}>
        </label>
        <label class="cdp-setting-check">
          <span>Ocultar painel esquerdo</span>
          <input type="checkbox" id="cdp-auto-hide-left" ${autoHideLeftSidebar ? 'checked' : ''}>
        </label>
        <label class="cdp-setting-check">
          <span>Ocultar painel direito</span>
          <input type="checkbox" id="cdp-auto-hide-right" ${autoHideRightSidebar ? 'checked' : ''}>
        </label>
        <hr class="cdp-setting-sep">
        <div class="cdp-setting-row">
          <span class="cdp-setting-label">Server host</span>
          <input type="text" id="cdp-ws-host" placeholder="localhost" class="cdp-input-text">
        </div>
        <div class="cdp-setting-row">
          <span class="cdp-setting-label">WS port</span>
          <input type="number" id="cdp-ws-port" placeholder="7891" min="1" max="65535" class="cdp-input-num">
        </div>
        <div class="cdp-setting-row">
          <span class="cdp-setting-label">WSS port</span>
          <input type="number" id="cdp-wss-port" placeholder="7892" min="1" max="65535" class="cdp-input-num">
        </div>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('cdp-follow-btn').addEventListener('click', () => {
      following = !following;
      saveSettings();
      updateOverlay();
      updateArrowRotation();
      if (!following) resetMapBearing();
      else if (lastPos && !rotateWithCamera) panToPlayer(lastPos.lng, lastPos.lat);
    });

    document.getElementById('cdp-settings-btn').addEventListener('click', () => {
      document.getElementById('cdp-settings-panel').classList.toggle('cdp-open');
    });

    document.getElementById('cdp-icon-size').addEventListener('input', (e) => {
      setIconSize(parseFloat(e.target.value));
    });

    document.getElementById('cdp-default-zoom').addEventListener('input', (e) => {
      setDefaultZoom(parseFloat(e.target.value));
    });

    document.getElementById('cdp-rotate-map').addEventListener('change', (e) => {
      setRotateWithPlayer(e.target.checked);
    });

    document.getElementById('cdp-rotate-camera').addEventListener('change', (e) => {
      setRotateWithCamera(e.target.checked);
    });

    const headingSel = document.getElementById('cdp-heading-src');
    headingSel.value = headingSource;
    headingSel.addEventListener('change', (e) => {
      headingSource = e.target.value;
      saveSettings();
    });

    document.getElementById('cdp-auto-hide-found').addEventListener('change', (e) => {
      setAutoHideSetting('found', e.target.checked);
    });

    document.getElementById('cdp-auto-hide-left').addEventListener('change', (e) => {
      setAutoHideSetting('left', e.target.checked);
    });

    document.getElementById('cdp-auto-hide-right').addEventListener('change', (e) => {
      setAutoHideSetting('right', e.target.checked);
    });

    document.getElementById('cdp-ws-host').addEventListener('change', (e) => {
      const val = e.target.value.trim();
      sendCmd({ cmd: 'set_server_config', wsHost: val || null });
    });

    document.getElementById('cdp-ws-port').addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      sendCmd({ cmd: 'set_server_config', wsPort: (val > 0 && val <= 65535) ? val : null });
    });

    document.getElementById('cdp-wss-port').addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      sendCmd({ cmd: 'set_server_config', wssPort: (val > 0 && val <= 65535) ? val : null });
    });

    setServerConfigInputs(serverConfig);

  }

  function updateOverlay() {
    const followBtn = document.getElementById('cdp-follow-btn');
    const coords    = document.getElementById('cdp-coords');
    const status    = document.getElementById('cdp-status');
    const overlay   = document.getElementById('cdp-overlay');
    if (!overlay) return;

    if (followBtn) followBtn.textContent = `Follow: ${following ? 'ON' : 'OFF'}`;
    overlay.classList.toggle('cdp-following', following);

    if (lastPos) {
      coords.textContent = `X ${lastPos.x.toFixed(0)}  Z ${lastPos.z.toFixed(0)}  Y ${lastPos.y.toFixed(0)}`;
    } else {
      coords.textContent = 'Waiting for player…';
    }

    if (status) {
      if (wsStatus === 'connected') {
        status.textContent = lastPos ? `Realm: ${lastPos.realm}` : 'Connected — move in-game';
        overlay.classList.remove('cdp-offline');
      } else {
        status.textContent = 'Server offline — run position_server.py';
        overlay.classList.add('cdp-offline');
      }
    }
  }

  // ── Toggle companion on/off (via custom event from popup) ──────────
  window.addEventListener('cdp-toggle-follow', () => {
    following = !following;
    saveSettings();
    updateOverlay();
    updateArrowRotation();
    if (!following) resetMapBearing();
    else if (lastPos && !rotateWithCamera) panToPlayer(lastPos.lng, lastPos.lat);
  });

  window.addEventListener('cdp-set-center-y', (e) => {
    const value = parseFloat(e.detail && e.detail.y);
    setCenterTeleportY(value);
  });

  window.addEventListener('cdp-set-icon-size', (e) => {
    const value = parseFloat(e.detail && e.detail.iconSize);
    setIconSize(value);
  });

  window.addEventListener('cdp-set-default-zoom', (e) => {
    const value = parseFloat(e.detail && e.detail.defaultZoom);
    setDefaultZoom(value);
  });

  window.addEventListener('cdp-set-auto-hide', (e) => {
    const detail = e.detail || {};
    setAutoHideSetting(detail.key, detail.value);
  });

  window.addEventListener('cdp-set-rotate-camera', (e) => {
    setRotateWithCamera(!!(e.detail && e.detail.value));
  });

  // Expose state for popup query
  window.__cdpGetState = () => ({
    following,
    wsStatus,
    lastPos,
    centerTeleportY,
    iconSize,
    defaultZoom,
    rotateWithPlayer,
    rotateWithCamera,
    autoHideFound,
    autoHideLeftSidebar,
    autoHideRightSidebar,
  });

  // ── Teleport visibility ──────────────────────────────────────────────
  function updateTeleportVisibility() {
    const wpBtn = document.getElementById('cdp-wp-toggle');
    const ctBtn = document.getElementById('cdp-center-tp');
    const wpPanel = document.getElementById('cdp-wp-panel');
    const ctPanel = document.getElementById('cdp-center-tp-panel');
    const display = teleportEnabled ? '' : 'none';
    if (wpBtn) wpBtn.style.display = display;
    if (ctBtn) ctBtn.style.display = display;
    if (!teleportEnabled) {
      if (wpPanel) wpPanel.style.display = 'none';
      if (ctPanel) ctPanel.style.display = 'none';
    }
  }

  // ── Init ───────────────────────────────────────────────────────────
  loadSettings();
  createCenterCrosshair();
  createOverlay();
  updateOverlay();
  waitForMap();
  waitForMapManager();
  applyAutoHideSettings();
  connect();
  ensureWpToggleBtn();
  ensureCenterTeleportBtn();
  ensureCenterTeleportPanel();
  ensureWaypointPanel();
  renderWaypoints();
  setInterval(() => {
    if (window.mapManager && typeof window.mapManager.updateFoundLocationsStyle === 'function')
      window.mapManager.updateFoundLocationsStyle();
  }, 50);
})();
