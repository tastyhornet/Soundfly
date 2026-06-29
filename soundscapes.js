// shared brain of the extension. the list of soundscapes, how domains map to a
// mood, and a tiny content classifier for sites we don't know. plain js so the
// content script and the worker can both load it (hangs off globalThis.sound).

// the soundscapes. all are live somafm streams (continuous ambient stations).
// id is what we store, url is what the offscreen <audio> plays.
const soundscapes = [
  { id: "groovesalad",   name: "Groove Salad",    mood: "chilled, easy",        url: "https://ice.somafm.com/groovesalad-128-mp3" },
  { id: "doomed",        name: "Doomed",          mood: "dark thriller",        url: "https://ice.somafm.com/doomed-128-mp3" },
  { id: "secretagent",   name: "Secret Agent",    mood: "spy tension",          url: "https://ice.somafm.com/secretagent-128-mp3" },
  { id: "deepspaceone",  name: "Deep Space One",  mood: "quiet, studious",      url: "https://ice.somafm.com/deepspaceone-128-mp3" },
  { id: "dronezone",     name: "Drone Zone",      mood: "atmospheric ambient",  url: "https://ice.somafm.com/dronezone-128-mp3" },
  { id: "vaporwaves",    name: "Vaporwaves",      mood: "playful, arcade-ish",  url: "https://ice.somafm.com/vaporwaves-128-mp3" },
  { id: "cliqhop",       name: "cliqhop idm",     mood: "blippy, game-y",       url: "https://ice.somafm.com/cliqhop-128-mp3" },
  { id: "beatblender",   name: "Beat Blender",    mood: "upbeat house",         url: "https://ice.somafm.com/beatblender-128-mp3" },
  { id: "spacestation",  name: "Space Station",   mood: "spaced-out electronica", url: "https://ice.somafm.com/spacestation-128-mp3" },
  { id: "defcon",        name: "DEF CON Radio",   mood: "hacker, techy",        url: "https://ice.somafm.com/defcon-128-mp3" },
  { id: "sonicuniverse", name: "Sonic Universe",  mood: "avant jazz",           url: "https://ice.somafm.com/sonicuniverse-128-mp3" },
  { id: "lush",          name: "Lush",            mood: "dreamy vocals",        url: "https://ice.somafm.com/lush-128-mp3" },
  { id: "fluid",         name: "Fluid",           mood: "future soul",          url: "https://ice.somafm.com/fluid-128-mp3" },
];

// the categories a page can fall into, each pointing at a soundscape id.
const categoryscape = {
  news:      "doomed",        // tense thriller, like the pitch asked
  finance:   "secretagent",   // spy money tension
  reference: "deepspaceone",  // wikipedia / docs / library hush
  social:    "vaporwaves",    // feeds get arcade energy
  gaming:    "cliqhop",       // blippy game sounds
  shopping:  "beatblender",   // mall-ish upbeat
  video:     "spacestation",
  tech:      "defcon",        // code / dev sites
  music:     "sonicuniverse",
  reading:   "groovesalad",   // blogs / articles, the gentle default
};

// known domains -> category. this is the "domain matching" half. matched by
// checking if the hostname ends with / contains one of these.
const domainmap = {
  "wikipedia.org": "reference", "wiktionary.org": "reference", "arxiv.org": "reference",
  "developer.mozilla.org": "tech", "stackoverflow.com": "tech", "github.com": "tech",
  "gitlab.com": "tech", "npmjs.com": "tech",
  "nytimes.com": "news", "bbc.com": "news", "bbc.co.uk": "news", "cnn.com": "news",
  "theguardian.com": "news", "reuters.com": "news", "apnews.com": "news",
  "bloomberg.com": "finance", "wsj.com": "finance", "tradingview.com": "finance",
  "coinbase.com": "finance", "finance.yahoo.com": "finance",
  "twitter.com": "social", "x.com": "social", "reddit.com": "social",
  "facebook.com": "social", "instagram.com": "social", "tiktok.com": "social",
  "mastodon.social": "social", "bsky.app": "social",
  "amazon.com": "shopping", "ebay.com": "shopping", "etsy.com": "shopping",
  "aliexpress.com": "shopping", "walmart.com": "shopping",
  "youtube.com": "video", "netflix.com": "video", "twitch.tv": "video", "vimeo.com": "video",
  "spotify.com": "music", "soundcloud.com": "music", "bandcamp.com": "music",
  "store.steampowered.com": "gaming", "ign.com": "gaming", "chess.com": "gaming",
};

// keyword buckets for the "content analysis" half. counted across the page text
// when the domain is unknown (or to back up a weak domain guess).
const keywords = {
  news:      ["breaking", "reporter", "headline", "published", "associated press", "correspondent", "developing story"],
  finance:   ["stock", "earnings", "market cap", "portfolio", "nasdaq", "ticker", "dividend", "crypto", "interest rate"],
  reference: ["encyclopedia", "documentation", "reference", "definition", "according to", "citation", "cite", "wiki"],
  social:    ["follow", "followers", "like", "retweet", "comment", "your feed", "trending", "post", "share this"],
  gaming:    ["gameplay", "level up", "achievement", "multiplayer", "respawn", "loot", "speedrun", "boss fight"],
  shopping:  ["add to cart", "checkout", "buy now", "free shipping", "in stock", "add to bag", "price", "best seller"],
  video:     ["watch", "episode", "subscribe", "views", "playlist", "now playing", "stream", "trailer"],
  tech:      ["function", "repository", "commit", "npm install", "api", "compile", "stack trace", "const ", "git clone"],
  music:     ["album", "tracklist", "listen", "discography", "artist", "lyrics", "playlist"],
  reading:   ["read more", "minute read", "posted on", "by the author", "blog", "newsletter", "subscribe to read"],
};

// pick a category from a hostname. returns null if we don't recognise it.
function domaincategory(host) {
  const h = (host || "").toLowerCase();
  for (const dom in domainmap) {
    if (h === dom || h.endsWith("." + dom) || h.includes(dom)) return domainmap[dom];
  }
  return null;
}

// score the page text into category buckets. og:type gives a strong nudge.
// returns { category, scores }.
function classifycontent(text, ogtype) {
  const t = (text || "").toLowerCase();
  const scores = {};
  for (const cat in keywords) {
    scores[cat] = 0;
    for (const kw of keywords[cat]) {
      if (t.includes(kw)) scores[cat] += 1;
    }
  }

  // og:type is a cheap, reliable signal a lot of sites set
  const og = (ogtype || "").toLowerCase();
  if (og.includes("article")) scores.news += 2;
  if (og.includes("video")) scores.video += 3;
  if (og.includes("product")) scores.shopping += 3;
  if (og.includes("music") || og.includes("song")) scores.music += 3;
  if (og.includes("profile")) scores.social += 2;

  // whichever bucket won, falling back to a calm read
  let best = "reading", top = 0;
  for (const cat in scores) {
    if (scores[cat] > top) { top = scores[cat]; best = cat; }
  }
  return { category: best, scores };
}

// the real decision: blend domain + content. domain wins when known, but a
// strong content signal can still tilt it. always returns a category.
function decidecategory(host, text, ogtype) {
  const dom = domaincategory(host);
  const { category: contentcat, scores } = classifycontent(text, ogtype);

  if (dom) {
    // trust the domain unless the page text screams something else loudly
    if (scores[contentcat] >= 4 && contentcat !== dom) return contentcat;
    return dom;
  }
  return contentcat;
}

function scapefor(category) {
  return categoryscape[category] || "groovesalad";
}

function scapebyid(id) {
  return soundscapes.find((s) => s.id === id) || soundscapes[0];
}

// tilt everything calmer after midnight. felt gimmicky in testing, left off.
// function nightmood(category) {
//   const hour = new Date().getHours();
//   if (hour >= 0 && hour < 5) return "reading";
//   return category;
// }

// second mapping that sent the louder moods elsewhere. a/b'd it, kept the one above.
// const categoryscape_alt = {
//   news: "doomed", finance: "deepspaceone", reference: "dronezone",
//   social: "beatblender", gaming: "vaporwaves", shopping: "fluid",
//   video: "spacestation", tech: "defcon", music: "lush", reading: "groovesalad",
// };

// earlier domaincategory that matched on an exact-suffix regex instead of contains.
// substring won - simpler and caught more subdomains.
// function domaincategory_re(host) {
//   const h = (host || "").toLowerCase();
//   for (const dom in domainmap) {
//     if (new RegExp("(^|\\.)" + dom.replace(/\./g, "\\.") + "$").test(h)) return domainmap[dom];
//   }
//   return null;
// }

// weighted scorer - gave the first keyword hit more pull than later ones. the flat
// +1 per hit above ranked sites just as well and was easier to reason about.
// function classifyweighted(text, ogtype) {
//   const t = (text || "").toLowerCase();
//   const scores = {};
//   for (const cat in keywords) {
//     scores[cat] = 0;
//     keywords[cat].forEach((kw, i) => { if (t.includes(kw)) scores[cat] += 1 / (i + 1); });
//   }
//   let best = "reading", top = 0;
//   for (const cat in scores) if (scores[cat] > top) { top = scores[cat]; best = cat; }
//   return { category: best, scores };
// }

// let a site vote for two moods and blend them (e.g. news + finance). sounded
// muddy in practice, so a single winner stayed.
// function toptwo(scores) {
//   return Object.keys(scores).sort((a, b) => scores[b] - scores[a]).slice(0, 2);
// }

globalThis.sound = {
  soundscapes, categoryscape, domainmap, keywords,
  domaincategory, classifycontent, decidecategory, scapefor, scapebyid,
};
