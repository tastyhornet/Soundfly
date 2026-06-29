# Soundfly

Gives every site its own background music. News goes tense and thriller-y,
Wikipedia gets quiet, social feeds get playful, dev sites get hacker vibes. It
works out the mood on its own, and you can override it per site when you don't
agree with its guess.

Basically: what if the web came with a soundtrack.

## How it picks the music

Two things:

- A list of known sites (Wikipedia, BBC, GitHub, Amazon, YouTube, Twitter and so
  on) that map straight to a mood.
- For everything else it reads the page (title, headings, meta, a bit of the body
  text, og:type) and guesses the category from keywords. So even a random shop
  it's never seen still gets shopping music.

If it knows the domain it goes with that, unless the page text really strongly
says something else.

## The music

13 ambient stations, all streamed live from SomaFM. A few of them:

- Doomed - dark/thriller, news
- Deep Space One - quiet, for reference/docs
- Vaporwaves - social feeds
- DEF CON Radio - dev/tech
- Beat Blender - shopping

The full list lives in soundscapes.js.

## Options

Click the toolbar icon:

- On/off, volume, mute
- Soundtrack for this site: auto, silence, pick a mood, pin a station, or paste
  your own stream link. Saved per site.
- Pause when the site plays its own sound (on by default), so it ducks out when
  you start a YouTube video and comes back after.

Streams loop and reconnect on their own if one drops.

## Install

1. Go to chrome://extensions and turn on developer mode
2. Load unpacked, pick this folder

First play might need one click in the popup since Chrome blocks autoplay
sometimes. It'll tell you if that happens.

## Files

- manifest.json - extension config (MV3)
- soundscapes.js - station list, domain map, the classifier
- content.js - reads the page and reports the mood
- background.js - tracks the active tab, applies overrides, drives the audio
- offscreen.html / offscreen.js - hidden page that actually plays the audio
- popup.html / popup.css / popup.js - the controls

Audio comes from SomaFM. They run on donations, so if you end up leaving this on a
lot, go throw them a few bucks.

## Notes

- Audio has to live in an offscreen document because MV3 service workers can't
  play sound. That's what the offscreen files are for.
- Needs internet, obviously. The SomaFM URLs are external but stable.
