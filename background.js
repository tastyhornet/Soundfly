// the conductor. tracks which tab is in front, what kind of site it is, applies
// any per-domain override + the user's settings, and tells the offscreen player
// what to stream.

importScripts("soundscapes.js");

// per-tab guess from the content script: tabId -> { host, category }
const tabstate = {};
let activetab = null;
let blocked = false; // set if the browser refused to autoplay

const defaults = { enabled: true, volume: 0.5, mute: false, duck: true };

async function getsettings() {
  const o = await chrome.storage.local.get("settings");
  return { ...defaults, ...(o.settings || {}) };
}
async function getoverrides() {
  const o = await chrome.storage.local.get("overrides");
  return o.overrides || {};
}

// ---- offscreen plumbing ----

async function hasoffscreen() {
  const c = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return c.length > 0;
}
let creating = null;
async function ensureoffscreen() {
  if (await hasoffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "stream the ambient soundtrack for the current site",
    });
  }
  await creating;
  creating = null;
}
function toplayer(msg) {
  chrome.runtime.sendMessage({ target: "offscreen", ...msg }).catch(() => {});
}

// ---- the decision ----

// figure out which soundscape (or none) the active tab should hear
async function resolve() {
  if (activetab == null || !tabstate[activetab]) return null;
  const { host, category } = tabstate[activetab];
  const overrides = await getoverrides();
  const ov = overrides[host];

  let scapeid;
  if (!ov || ov === "auto") scapeid = sound.scapefor(category);
  else if (ov === "off") return { host, category, scape: null };
  else if (ov.startsWith("custom:")) {
    // your own music - a stream url the user pasted for this site
    const url = ov.slice(7);
    return { host, category, scape: { id: "custom", name: "your music", mood: "your pick", url } };
  }
  else if (ov.startsWith("scape:")) scapeid = ov.slice(6);
  else scapeid = sound.scapefor(ov); // ov is a category name

  return { host, category, scape: sound.scapebyid(scapeid) };
}

// is the current site making its own sound? (video, music, etc.)
async function siteaudible() {
  if (activetab == null) return false;
  try {
    const t = await chrome.tabs.get(activetab);
    return !!t.audible;
  } catch {
    return false;
  }
}

// push the current decision to the player
async function update() {
  const s = await getsettings();
  const r = await resolve();

  // step aside when the page itself is playing audio
  const stepaside = s.duck && (await siteaudible());

  if (!s.enabled || s.mute || stepaside || !r || !r.scape) {
    toplayer({ type: "stop" });
    return;
  }
  await ensureoffscreen();
  toplayer({ type: "play", url: r.scape.url, volume: s.volume });
}

// tried a soft crossfade when the scape changes instead of a hard cut. nice in
// theory but the offscreen audio stalled on quick tab hops, so it's parked.
// let lasturl = null;
// async function crossfade(nexturl, vol) {
//   if (nexturl === lasturl) return;
//   toplayer({ type: "fade", to: 0, ms: 400 });
//   toplayer({ type: "play", url: nexturl, volume: 0 });
//   toplayer({ type: "fade", to: vol, ms: 400 });
//   lasturl = nexturl;
// }

// ---- tab tracking ----

chrome.runtime.onStartup.addListener(initactive);
chrome.runtime.onInstalled.addListener(initactive);
async function initactive() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) activetab = tab.id;
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  activetab = tabId;
  blocked = false;
  update();
});

chrome.windows.onFocusChanged.addListener(async (winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: winId });
  if (tab) { activetab = tab.id; update(); }
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId !== activetab) return;
  // a navigation may drop our guess; content.js will re-report shortly
  if (info.url || info.status === "loading") delete tabstate[tabId];
  // the site started or stopped making sound -> re-decide (duck / un-duck)
  if (info.audible !== undefined) update();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabstate[tabId];
});

// ---- messages ----

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // a page told us what it is
  if (msg.type === "page" && sender.tab) {
    tabstate[sender.tab.id] = { host: msg.host, category: msg.category };
    if (sender.tab.id === activetab) update();
    return;
  }

  // offscreen says autoplay got blocked
  if (msg.type === "blocked") {
    blocked = true;
    return;
  }

  // popup asking for the current picture
  if (msg.type === "status") {
    (async () => {
      const s = await getsettings();
      const overrides = await getoverrides();
      const r = await resolve();
      reply({
        settings: s,
        blocked,
        host: r ? r.host : null,
        category: r ? r.category : null,
        scape: r ? r.scape : null,
        override: r ? overrides[r.host] || "auto" : "auto",
        soundscapes: sound.soundscapes,
        categoryscape: sound.categoryscape,
      });
    })();
    return true; // async reply
  }

  // popup changed a setting
  if (msg.type === "settings") {
    (async () => {
      const s = { ...(await getsettings()), ...msg.patch };
      await chrome.storage.local.set({ settings: s });
      if (msg.patch.volume != null) toplayer({ type: "volume", volume: s.volume });
      await update();
      reply && reply({ ok: true });
    })();
    return true;
  }

  // popup set a per-domain override
  if (msg.type === "override") {
    (async () => {
      const overrides = await getoverrides();
      if (!msg.value || msg.value === "auto") delete overrides[msg.host];
      else overrides[msg.host] = msg.value;
      await chrome.storage.local.set({ overrides });
      await update();
      reply && reply({ ok: true });
    })();
    return true;
  }

  // user clicked play in the popup (counts as a gesture to beat autoplay block)
  if (msg.type === "start") {
    blocked = false;
    update();
    return;
  }
});

// re-decided on a fixed timer instead of on tab/focus events. wasteful - it
// re-fetched settings every few seconds for no change. event-driven won.
// setInterval(update, 4000);

// remembered the last category per window so a new tab started on that mood
// before its content loaded. nice idea, but it guessed wrong often enough to drop.
// const lastbywindow = {};
// chrome.tabs.onCreated.addListener((tab) => {
//   if (tab.windowId in lastbywindow) tabstate[tab.id] = { host: "", category: lastbywindow[tab.windowId] };
// });
