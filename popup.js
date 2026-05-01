// Query state from the active MapGenie tab's content script

async function getActiveMapGeniTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('mapgenie.io')) {
        resolve(tab);
      } else {
        resolve(null);
      }
    });
  });
}

async function queryCompanionState(tab) {
  try {
    const [state] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => window.__cdpGetState?.(),
    });
    return state?.result || null;
  } catch (_) {
    return null;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureCompanionLoaded(tab) {
  let state = await queryCompanionState(tab);
  if (state) return state;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['overlay.css'],
    });
  } catch (_) {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['bridge.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      files: ['content.js'],
    });
  } catch (_) {}

  await delay(200);
  return queryCompanionState(tab);
}

async function dispatchToCompanion(tab, eventName, detail = {}) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (name, payload) => window.dispatchEvent(new CustomEvent(name, {
      detail: payload,
    })),
    args: [eventName, detail],
  });
}

async function refresh() {
  const tab = await getActiveMapGeniTab();
  if (!tab) {
    document.getElementById('ws-label').textContent = 'Open a MapGenie tab first';
    return;
  }

  const state = await ensureCompanionLoaded(tab);

  const dot     = document.getElementById('ws-dot');
  const wsLabel = document.getElementById('ws-label');
  const coords  = document.getElementById('coords');
  const realm   = document.getElementById('realm');
  const followBtn = document.getElementById('follow-btn');
  const centerY = document.getElementById('center-y');
  const centerYVal = document.getElementById('center-y-val');
  const iconSize = document.getElementById('icon-size');
  const iconSizeVal = document.getElementById('icon-size-val');
  const defaultZoom = document.getElementById('default-zoom');
  const defaultZoomVal = document.getElementById('default-zoom-val');
  const autoHideFound = document.getElementById('auto-hide-found');
  const autoHideLeft = document.getElementById('auto-hide-left');
  const autoHideRight = document.getElementById('auto-hide-right');
  const rotateCamera = document.getElementById('rotate-camera');

  if (!state) {
    dot.className = 'status-dot disconnected';
    wsLabel.textContent = 'Reload the MapGenie tab';
    return;
  }

  dot.className = `status-dot ${state.wsStatus === 'connected' ? 'connected' : 'disconnected'}`;
  wsLabel.textContent = state.wsStatus === 'connected' ? 'Server connected' : 'Server offline';

  if (state.lastPos) {
    coords.textContent = `${state.lastPos.x.toFixed(0)}, ${state.lastPos.z.toFixed(0)}`;
    realm.textContent  = state.lastPos.realm;
  } else {
    coords.textContent = 'waiting…';
    realm.textContent  = '--';
  }

  followBtn.textContent = `Follow: ${state.following ? 'ON' : 'OFF'}`;
  followBtn.className   = state.following ? 'active' : '';
  if (centerY && typeof state.centerTeleportY === 'number' &&
      document.activeElement !== centerY) {
    centerY.value = state.centerTeleportY;
    if (centerYVal) centerYVal.textContent = Math.round(state.centerTeleportY).toString();
  }
  if (iconSize && typeof state.iconSize === 'number' &&
      document.activeElement !== iconSize) {
    iconSize.value = state.iconSize;
    if (iconSizeVal) iconSizeVal.textContent = state.iconSize.toFixed(1);
  }
  if (defaultZoom && typeof state.defaultZoom === 'number' &&
      document.activeElement !== defaultZoom) {
    defaultZoom.value = state.defaultZoom;
    if (defaultZoomVal) defaultZoomVal.textContent = state.defaultZoom.toFixed(1);
  }
  if (autoHideFound && typeof state.autoHideFound === 'boolean')
    autoHideFound.checked = state.autoHideFound;
  if (autoHideLeft && typeof state.autoHideLeftSidebar === 'boolean')
    autoHideLeft.checked = state.autoHideLeftSidebar;
  if (autoHideRight && typeof state.autoHideRightSidebar === 'boolean')
    autoHideRight.checked = state.autoHideRightSidebar;
  if (rotateCamera && typeof state.rotateWithCamera === 'boolean')
    rotateCamera.checked = state.rotateWithCamera;
}

document.getElementById('follow-btn').addEventListener('click', async () => {
  const tab = await getActiveMapGeniTab();
  if (!tab) return;
  const state = await ensureCompanionLoaded(tab);
  if (!state) return;
  await dispatchToCompanion(tab, 'cdp-toggle-follow');
  setTimeout(refresh, 100);
});

document.getElementById('center-y').addEventListener('input', async (e) => {
  const value = parseFloat(e.target.value);
  if (!Number.isFinite(value)) return;
  const centerYVal = document.getElementById('center-y-val');
  if (centerYVal) centerYVal.textContent = Math.round(value).toString();
  const tab = await getActiveMapGeniTab();
  if (!tab) return;
  const state = await ensureCompanionLoaded(tab);
  if (!state) return;
  await dispatchToCompanion(tab, 'cdp-set-center-y', { y: value });
  setTimeout(refresh, 100);
});

document.getElementById('icon-size').addEventListener('input', async (e) => {
  const value = parseFloat(e.target.value);
  if (!Number.isFinite(value)) return;
  const iconSizeVal = document.getElementById('icon-size-val');
  if (iconSizeVal) iconSizeVal.textContent = value.toFixed(1);
  const tab = await getActiveMapGeniTab();
  if (!tab) return;
  const state = await ensureCompanionLoaded(tab);
  if (!state) return;
  await dispatchToCompanion(tab, 'cdp-set-icon-size', { iconSize: value });
  setTimeout(refresh, 100);
});

document.getElementById('default-zoom').addEventListener('input', async (e) => {
  const value = parseFloat(e.target.value);
  if (!Number.isFinite(value)) return;
  const defaultZoomVal = document.getElementById('default-zoom-val');
  if (defaultZoomVal) defaultZoomVal.textContent = value.toFixed(1);
  const tab = await getActiveMapGeniTab();
  if (!tab) return;
  const state = await ensureCompanionLoaded(tab);
  if (!state) return;
  await dispatchToCompanion(tab, 'cdp-set-default-zoom', { defaultZoom: value });
  setTimeout(refresh, 100);
});

async function setAutoHide(key, value) {
  const tab = await getActiveMapGeniTab();
  if (!tab) return;
  const state = await ensureCompanionLoaded(tab);
  if (!state) return;
  await dispatchToCompanion(tab, 'cdp-set-auto-hide', { key, value });
  setTimeout(refresh, 100);
}

document.getElementById('auto-hide-found').addEventListener('change', (e) => {
  setAutoHide('found', e.target.checked);
});

document.getElementById('auto-hide-left').addEventListener('change', (e) => {
  setAutoHide('left', e.target.checked);
});

document.getElementById('auto-hide-right').addEventListener('change', (e) => {
  setAutoHide('right', e.target.checked);
});

document.getElementById('rotate-camera').addEventListener('change', async (e) => {
  const tab = await getActiveMapGeniTab();
  if (!tab) return;
  const state = await ensureCompanionLoaded(tab);
  if (!state) return;
  await dispatchToCompanion(tab, 'cdp-set-rotate-camera', { value: e.target.checked });
  setTimeout(refresh, 100);
});

// Initial load + polling while popup is open
refresh();
loadServerSettings();
const iv = setInterval(refresh, 1000);
window.addEventListener('unload', () => clearInterval(iv));

// ── Server settings (host/port) ──────────────────────────────────────

function loadServerSettings() {
  chrome.storage.local.get(['wsHost', 'wsPort', 'wssPort'], (data) => {
    const hostEl = document.getElementById('ws-host');
    const portEl = document.getElementById('ws-port');
    const sslEl  = document.getElementById('wss-port');
    if (hostEl && data.wsHost) hostEl.value = data.wsHost;
    if (portEl && data.wsPort) portEl.value = data.wsPort;
    if (sslEl  && data.wssPort) sslEl.value = data.wssPort;
  });
}

function saveServerSetting(key, value) {
  const obj = {};
  obj[key] = value;
  chrome.storage.local.set(obj);
}

document.getElementById('ws-host').addEventListener('change', (e) => {
  const val = e.target.value.trim();
  if (val) saveServerSetting('wsHost', val);
  else chrome.storage.local.remove('wsHost');
});

document.getElementById('ws-port').addEventListener('change', (e) => {
  const val = parseInt(e.target.value, 10);
  if (val > 0 && val <= 65535) saveServerSetting('wsPort', val);
  else chrome.storage.local.remove('wsPort');
});

document.getElementById('wss-port').addEventListener('change', (e) => {
  const val = parseInt(e.target.value, 10);
  if (val > 0 && val <= 65535) saveServerSetting('wssPort', val);
  else chrome.storage.local.remove('wssPort');
});
