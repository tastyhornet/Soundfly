// runs on every page. reads a little of the page, decides what kind of site it
// is (domain + content), and tells the worker so it can pick the soundtrack.

let lastsent = "";

// grab a readable sample of the page without hauling the whole dom around
function pagetext() {
  const bits = [document.title];

  const desc = document.querySelector('meta[name="description"]');
  if (desc) bits.push(desc.content || "");
  const kw = document.querySelector('meta[name="keywords"]');
  if (kw) bits.push(kw.content || "");

  // headings carry a lot of meaning for cheap
  document.querySelectorAll("h1, h2").forEach((h) => bits.push(h.textContent || ""));

  // a chunk of body text, capped so we don't read a novel
  bits.push((document.body ? document.body.innerText : "").slice(0, 4000));

  return bits.join(" ");
}

function ogtype() {
  const m = document.querySelector('meta[property="og:type"]');
  return m ? m.content : "";
}

function report() {
  const host = location.hostname;
  const category = sound.decidecategory(host, pagetext(), ogtype());

  // don't spam the worker if nothing changed
  const sig = host + ":" + category;
  if (sig === lastsent) return;
  lastsent = sig;

  chrome.runtime.sendMessage({ type: "page", host, category }).catch(() => {});
}

// first read once the page settles a bit (some text loads late)
setTimeout(report, 600);

// re-check when the tab regains focus and on spa url changes
window.addEventListener("focus", report);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) report();
});

// cheap spa navigation watch - url changes without a reload
let lasturl = location.href;
setInterval(() => {
  if (location.href !== lasturl) {
    lasturl = location.href;
    lastsent = ""; // force a fresh read
    setTimeout(report, 500);
  }
}, 1500);

// lighter sample that only read title + headings, skipped the body. missed too
// many content-only pages, so the fuller read above stayed.
// function pagetext_light() {
//   const bits = [document.title];
//   document.querySelectorAll("h1, h2, h3").forEach((h) => bits.push(h.textContent || ""));
//   return bits.join(" ");
// }

// tried re-reporting on scroll depth too (deep read = "reading"). felt noisy, dropped it.
// window.addEventListener("scroll", () => {
//   if (window.scrollY > document.body.scrollHeight * 0.6) report();
// });
