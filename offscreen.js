// the only place audio actually plays. the worker sends play/stop/volume here.
// does a short crossfade so switching sites isn't a jump-cut.

const player = document.getElementById("player");
player.loop = true; // keep going, never run out
let target = 0.5; // where the volume should settle
let fading = null;
let lasturl = ""; // what we should be playing, for reconnecting

// streams can drop. if it errors or ends while we still want sound, reconnect.
function reconnect() {
  if (!lasturl) return;
  setTimeout(() => {
    player.src = lasturl;
    player.play().catch(() => {});
  }, 1500);
}
player.addEventListener("error", reconnect);
player.addEventListener("ended", reconnect);

// ramp the real volume toward a goal over ~500ms
function fadeto(goal, done) {
  if (fading) clearInterval(fading);
  fading = setInterval(() => {
    const diff = goal - player.volume;
    if (Math.abs(diff) < 0.04) {
      player.volume = goal;
      clearInterval(fading);
      fading = null;
      if (done) done();
    } else {
      player.volume = Math.min(1, Math.max(0, player.volume + diff * 0.2));
    }
  }, 30);
}

async function play(url, volume) {
  target = volume;
  lasturl = url; // remember it so a dropped stream can reconnect
  // already on this stream? just settle the volume.
  if (player.src === url && !player.paused) {
    fadeto(volume);
    return;
  }
  // new stream: fade out the old, swap, fade in
  fadeto(0, async () => {
    player.src = url;
    player.volume = 0;
    try {
      await player.play();
      fadeto(target);
    } catch (e) {
      // autoplay was blocked - tell the worker so the popup can show "click to start"
      chrome.runtime.sendMessage({ type: "blocked" }).catch(() => {});
    }
  });
}

function stop() {
  lasturl = ""; // deliberate stop, don't auto-reconnect
  fadeto(0, () => player.pause());
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "play") play(msg.url, msg.volume);
  else if (msg.type === "stop") stop();
  else if (msg.type === "volume") fadeto(msg.volume);
});

// hard swap with no crossfade. snappier but the jump-cut was jarring, kept the fade.
// function playnow(url, volume) {
//   lasturl = url;
//   player.src = url;
//   player.volume = volume;
//   player.play().catch(() => {});
// }

// reconnect with a backoff that grew on repeated drops. real streams recover fast,
// so the flat 1.5s wait above was enough.
// let backoff = 1500;
// function reconnect_backoff() {
//   if (!lasturl) return;
//   setTimeout(() => { player.src = lasturl; player.play().catch(() => {}); }, backoff);
//   backoff = Math.min(backoff * 2, 20000);
// }

// faded volume by the page's own loudness so quiet sites got more soundtrack.
// needed the tab capture permission to read it - not worth the scope, parked.
// function ducktolevel(sitelevel) {
//   const room = Math.max(0, 1 - sitelevel);
//   fadeto(target * room);
// }

// gapless preload of the next stream into a second <audio> before swapping. shaved
// the reconnect blip but doubled the data use just idling, so it didn't ship.
// const warm = document.createElement("audio");
// function preload(url) {
//   warm.src = url;
//   warm.load();
// }
