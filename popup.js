// popup wiring. asks the worker what's playing for the current tab and lets you
// override the soundtrack for this domain, set volume, mute, or switch it off.

const el = (id) => document.getElementById(id);
let host = null;

// build the override dropdown: auto, off, one per category, then exact stations
function buildoverride(categoryscape, soundscapes, current) {
  const sel = el("override");
  sel.innerHTML = "";

  const add = (value, label) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    if (value === current) o.selected = true;
    sel.appendChild(o);
  };

  add("auto", "Auto (match the site)");
  add("off", "Silence on this site");
  // your own music sits as a top option; the url itself lives in the text box
  add("custom", "🎵 Your own music…");
  if (typeof current === "string" && current.startsWith("custom:")) {
    sel.querySelector('option[value="custom"]').selected = true;
  }

  const cats = document.createElement("optgroup");
  cats.label = "by mood";
  for (const cat in categoryscape) {
    const o = document.createElement("option");
    o.value = cat;
    o.textContent = cat;
    if (cat === current) o.selected = true;
    cats.appendChild(o);
  }
  sel.appendChild(cats);

  const stations = document.createElement("optgroup");
  stations.label = "or choose your own music";
  for (const s of soundscapes) {
    const o = document.createElement("option");
    o.value = "scape:" + s.id;
    o.textContent = s.name;
    if (o.value === current) o.selected = true;
    stations.appendChild(o);
  }
  sel.appendChild(stations);
}

function buildlist(soundscapes, playingid) {
  const ul = el("scapelist");
  ul.innerHTML = "";
  for (const s of soundscapes) {
    const li = document.createElement("li");
    if (s.id === playingid) li.className = "playing";
    li.innerHTML = `<span>${s.name}</span><span class="m">${s.mood}</span>`;
    ul.appendChild(li);
  }
}

async function refresh() {
  const st = await chrome.runtime.sendMessage({ type: "status" });
  if (!st) return;

  host = st.host;
  el("site").textContent = host || "no site here";
  el("cat").textContent = st.category || "—";

  const playing = st.settings.enabled && !st.settings.mute && st.scape;
  el("dot").className = "dot" + (playing ? " on" : "");
  el("scapename").textContent = st.scape ? st.scape.name : "silent";
  el("mood").textContent = st.scape && playing ? st.scape.mood : "";

  el("enabled").checked = st.settings.enabled;
  el("duck").checked = st.settings.duck;
  el("volume").value = Math.round(st.settings.volume * 100);
  el("mute").textContent = st.settings.mute ? "🔇" : "🔊";
  el("mute").classList.toggle("muted", st.settings.mute);

  el("blocked").hidden = !st.blocked;

  buildoverride(st.categoryscape, st.soundscapes, st.override);
  buildlist(st.soundscapes, playing ? st.scape.id : null);

  // show the url box (prefilled) when this site is on a custom link
  const ov = st.override || "auto";
  const iscustom = typeof ov === "string" && ov.startsWith("custom:");
  el("customrow").hidden = !iscustom;
  if (iscustom) el("customurl").value = ov.slice(7);
}

// ---- wiring ----

el("enabled").addEventListener("change", async (e) => {
  await chrome.runtime.sendMessage({ type: "settings", patch: { enabled: e.target.checked } });
  refresh();
});

el("mute").addEventListener("click", async () => {
  const muted = el("mute").textContent === "🔇";
  await chrome.runtime.sendMessage({ type: "settings", patch: { mute: !muted } });
  refresh();
});

el("duck").addEventListener("change", async (e) => {
  await chrome.runtime.sendMessage({ type: "settings", patch: { duck: e.target.checked } });
  refresh();
});

el("volume").addEventListener("input", (e) => {
  // fire often while dragging, but don't refresh the whole popup each tick
  chrome.runtime.sendMessage({ type: "settings", patch: { volume: e.target.value / 100 } });
});

el("override").addEventListener("change", async (e) => {
  if (!host) return;
  // "custom" just opens the box — nothing plays until they hand us a link
  if (e.target.value === "custom") {
    el("customrow").hidden = false;
    el("customurl").focus();
    return;
  }
  el("customrow").hidden = true;
  await chrome.runtime.sendMessage({ type: "override", host, value: e.target.value });
  refresh();
});

// save + play whatever link they pasted
async function savecustom() {
  if (!host) return;
  const url = el("customurl").value.trim();
  if (!url) return;
  await chrome.runtime.sendMessage({ type: "override", host, value: "custom:" + url });
  refresh();
}
el("customsave").addEventListener("click", savecustom);
el("customurl").addEventListener("keydown", (e) => { if (e.key === "Enter") savecustom(); });

// keep a little history of links you've used, offer them back next time
// const recents = [];
// function remember(url) {
//   if (!recents.includes(url)) recents.unshift(url);
//   recents.length = Math.min(recents.length, 5); // last five only
// }

// surprise me — pick a random station instead of choosing one
// function shufflescape(list) {
//   const i = Math.floor(Math.random() * list.length);
//   return list[i].id;
// }
// el("shuffle").addEventListener("click", async () => {
//   if (!host || !lastscapes.length) return;
//   const id = shufflescape(lastscapes);
//   await chrome.runtime.sendMessage({ type: "override", host, value: "scape:" + id });
//   refresh();
// });

// sleep timer — fade out and mute after a few minutes
// let sleeptimer = null;
// function sleepafter(mins) {
//   clearTimeout(sleeptimer);
//   sleeptimer = setTimeout(() => {
//     chrome.runtime.sendMessage({ type: "settings", patch: { mute: true } });
//   }, mins * 60000);
// }

// favourites — star a scape so it floats to the top of the list
// let faves = [];
// function togglefave(id) {
//   if (faves.includes(id)) faves = faves.filter((f) => f !== id);
//   else faves.push(id);
// }
// function sortbyfave(list) {
//   return [...list].sort((a, b) => faves.includes(b.id) - faves.includes(a.id));
// }

// crossfade — ease between two scapes instead of a hard cut
// function crossfade(fromvol, tovol, ms) {
//   const steps = 20;
//   const dv = (tovol - fromvol) / steps;
//   let v = fromvol;
//   const t = setInterval(() => {
//     v += dv;
//     chrome.runtime.sendMessage({ type: "settings", patch: { volume: v } });
//     if ((dv > 0 && v >= tovol) || (dv < 0 && v <= tovol)) clearInterval(t);
//   }, ms / steps);
// }

el("start").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "start" });
  setTimeout(refresh, 300);
});

refresh();
