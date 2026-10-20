// Baseline data updater. Runs on GitHub Actions (every 30 minutes and on each push).
// Fetches news feeds, YouTube coaching channels and ESPN tennis scoreboards,
// and writes small JSON files into site/data/ for the app to read.
// Every source is optional: a failure is logged in status.json and skipped.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../site/data/', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; BaselineTennisApp/1.0; personal use)';
const status = { generatedAt: new Date().toISOString(), sources: {} };

async function get(url, { json = false, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return json ? await r.json() : await r.text();
  } finally { clearTimeout(t); }
}

// ---------- tiny RSS / Atom parser ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };
export function decode(s = '') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENT[e.toLowerCase()] ?? m;
    });
}
const strip = s => decode(decode(s || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };
const attr = (block, name, a) => { const m = block.match(new RegExp(`<${name}\\s[^>]*${a}=["']([^"']+)["']`, 'i')); return m ? decode(m[1]) : ''; };

export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = strip(tag(b, 'title'));
    let link = strip(tag(b, 'link'));
    if (!link || !/^https?:/.test(link)) link = attr(b, 'link', 'href');
    const date = strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const desc = strip(tag(b, 'description') || tag(b, 'summary') || tag(b, 'media:description'));
    const image = attr(b, 'media:thumbnail', 'url') || attr(b, 'media:content', 'url') || attr(b, 'enclosure', 'url') || '';
    items.push({ title, link, date, desc, image, raw: b });
  }
  return items;
}

// ---------- news ----------
const NEWS_SOURCES = [
  { id: 'atp', name: 'ATP Tour', url: 'https://www.atptour.com/en/media/rss-feed/xml-feed', tour: 'ATP' },
  { id: 'tennis365', name: 'Tennis365', url: 'https://www.tennis365.com/feed' },
  { id: 'espn', name: 'ESPN', url: 'https://www.espn.com/espn/rss/tennis/news' },
  { id: 'bbc', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/tennis/rss.xml' },
  { id: 'nyt', name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Tennis.xml', filter: true },
  { id: 'athletic', name: 'The Athletic', url: 'https://www.nytimes.com/athletic/rss/tennis/', filter: true },
  // Google News searches fill gaps for sites without their own feed (results link through Google).
  { id: 'gn-wta', name: 'WTA', url: 'https://news.google.com/rss/search?q=site:wtatennis.com/news+when:7d&hl=en-US&gl=US&ceid=US:en', tour: 'WTA', google: true },
  { id: 'gn-athletic', name: 'The Athletic', url: 'https://news.google.com/rss/search?q=tennis+site:nytimes.com/athletic+when:7d&hl=en-US&gl=US&ceid=US:en', google: true },
  { id: 'gn-atp', name: 'ATP Tour', url: 'https://news.google.com/rss/search?q=site:atptour.com/en/news+when:7d&hl=en-US&gl=US&ceid=US:en', tour: 'ATP', google: true },
];

const WTA_NAMES = ['sabalenka','swiatek','gauff','rybakina','pegula','andreeva','paolini','zheng','navarro','keys','badosa','muchova','svitolina','ostapenko','kostyuk','chwalinska','kartal','eala','alexandrova','mertens','krejcikova','vondrousova','osaka','raducanu','jabeur','kasatkina','samsonova','shnaider','noskova','haddad maia','bencic','anisimova','fernandez','kenin','stephens','kalinskaya','boulter','putintseva','linette','frech','vekic','sakkari','collins','azarenka','siniakova','townsend','stefani','dabrowski'];
const ATP_NAMES = ['sinner','alcaraz','zverev','djokovic','fritz','draper','de minaur','medvedev','rune','ruud','tsitsipas','shelton','paul','dimitrov','rublev','hurkacz','humbert','fils','cobolli','mensik','musetti','auger-aliassime','lehecka','tiafoe','khachanov','davidovich fokina','jodar','fonseca','mpetshi perricard','griekspoor','bublik','machac','popyrin','berrettini','monfils','wawrinka','nadal','federer','murray','korda','navone','arnaldi'];
const SLAMS = ['australian open','roland garros','roland-garros','french open','wimbledon','us open','u.s. open','grand slam'];

function classify(title, desc, fixedTour) {
  const t = (title + ' ' + desc).toLowerCase();
  const hasW = /\bwta\b|\bwomen'?s\b|\bbillie jean king cup\b/.test(t) || WTA_NAMES.some(n => t.includes(n));
  const hasA = /\batp\b|\bmen'?s\b|\bdavis cup\b/.test(t) || ATP_NAMES.some(n => t.includes(n));
  const tour = fixedTour || (hasW && !hasA ? 'WTA' : hasA && !hasW ? 'ATP' : 'TOUR');
  const slam = SLAMS.some(s => t.includes(s));
  return { tour, slam };
}
const PRO_RE = new RegExp('\\b(' + [...WTA_NAMES, ...ATP_NAMES].map(n => n.replace(/[-]/g, '.')).join('|') + ')\\b', 'i');
const isTennis = t => /\b(tennis|atp|wta|grand slam|wimbledon|roland garros|french open|us open|australian open|davis cup|billie jean king cup|united cup|laver cup)\b/i.test(t) || PRO_RE.test(t);
// Draw sheets, order-of-play PDFs and other non-article pages that some searches return.
const isJunk = t => / \| /.test(t) || t.split(/\s+/).length < 4 || /^[^a-z]*$/.test(t) || /\b(draw ls|order of play|draws?\s*$|pdf)\b/i.test(t);
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

async function buildNews() {
  const all = [];
  for (const s of NEWS_SOURCES) {
    try {
      const items = parseFeed(await get(s.url)).slice(0, 30);
      let n = 0;
      for (const it of items) {
        if (!it.title || !it.link) continue;
        let title = it.title, source = s.name;
        if (s.google) { const m = title.match(/^(.*) - ([^-]+)$/); if (m) { title = m[1].trim(); source = m[2].trim() || s.name; } }
        if (isJunk(title)) continue;
        if ((s.filter || s.google) && !isTennis(title + ' ' + it.desc)) continue;
        const ts = Date.parse(it.date) || Date.now();
        if (Date.now() - ts > 10 * 864e5) continue; // last 10 days only
        const desc = s.google ? '' : it.desc.slice(0, 260);
        all.push({ title, link: it.link, source, date: new Date(ts).toISOString(), desc, image: /^https:/.test(it.image) ? it.image : '', ...classify(title, desc, s.tour) });
        n++;
      }
      status.sources[s.id] = { ok: true, items: n };
    } catch (e) { status.sources[s.id] = { ok: false, error: String(e.message || e) }; }
  }
  // De-duplicate (prefer the direct, non-Google copy, which comes first in the source list).
  const seen = new Set(), out = [];
  for (const a of all) { const k = norm(a.title).slice(0, 70); if (seen.has(k)) continue; seen.add(k); out.push(a); }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out.slice(0, 120);
}

// ---------- Pro Tips videos ----------
const CHANNELS = [
  // coaching
  { handle: 'EssentialTennis', name: 'Essential Tennis', kind: 'coach' },
  { handle: 'TopTennisTraining', name: 'Top Tennis Training', kind: 'coach' },
  { handle: 'IntuitiveTennis', name: 'Intuitive Tennis', kind: 'coach' },
  { handle: 'FeelTennis', name: 'Feel Tennis', kind: 'coach' },
  { handle: 'TennisEvolution', name: 'Tennis Evolution', kind: 'coach' },
  { handle: 'OnlineTennisInstruction', name: 'Online Tennis Instruction', kind: 'coach' },
  // physical therapy / fitness (only videos matching body-care keywords are kept)
  { handle: 'ThePrehabGuys', name: 'The Prehab Guys', kind: 'body' },
  { handle: 'BobandBrad', name: 'Bob & Brad', kind: 'body' },
  { handle: 'BodyweightWarrior', name: 'Tom Merrick', kind: 'body' },
];
const CATS = [
  ['Rehab', /\b(rehab|recover(y|ing)? from|tennis elbow|golfer'?s elbow|tendon|tendinitis|tendinopathy|rotator cuff|sprain|strain|pain relief|(back|knee|shoulder|elbow|wrist|hip|neck|ankle) pain|fix (your|a) (back|knee|shoulder|elbow|wrist|hip))\b/i],
  ['Injury Prevention', /\b(warm[- ]?up|prevent|avoid(ing)? injur|injury[- ]proof|prehab|protect (your|the)|shoulder health|healthy (knees|shoulders|back|elbows?))\b/i],
  ['Fitness & Recovery', /\b(stretch|mobility|flexib|hydrat|recovery|strength|workout|exercise|gym|core|cardio|nutrition|yoga|foam roll)\b/i],
  ['Training', /\b(drill|footwork|practice|training|routine|session|consisten|match play|tactic|strategy|doubles|movement|split step)\b/i],
  ['Technique', /\b(forehand|backhand|serve|volley|slice|topspin|grip|swing|technique|return|overhead|smash|lob|drop shot|kick serve|stroke)\b/i],
];
const BODY_REQUIRED = /\b(tennis|shoulder|elbow|wrist|knee|hip|ankle|back|stretch|mobility|warm[- ]?up|rotator|forearm|grip strength|hamstring|calf|achilles)\b/i;

async function channelId(handle) {
  const html = await get(`https://www.youtube.com/@${handle}`);
  const m = html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error('channel id not found');
  return m[1];
}

async function buildVideos() {
  const vids = [];
  let cache = {};
  try { cache = JSON.parse(await readFile(new URL('channels.json', OUT), 'utf8')); } catch {}
  for (const c of CHANNELS) {
    const key = 'yt-' + c.handle;
    try {
      const id = cache[c.handle] || await channelId(c.handle);
      cache[c.handle] = id;
      const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
      let n = 0;
      for (const e of parseFeed(xml)) {
        const vid = (e.raw.match(/<yt:videoId>([^<]+)</) || [])[1];
        if (!vid || /#shorts|\bshorts?\b/i.test(e.title)) continue;
        if (c.kind === 'body' && !BODY_REQUIRED.test(e.title)) continue;
        // Skip livestreams, promotions, gear reviews and pro-tour commentary; keep only instruction.
        if (/\b(live|livestream|stream|book|giveaway|podcast|review|unboxing|ball machine|acemate|drama|controversy|reacts?|reaction|news|q ?& ?a)\b/i.test(e.title)) continue;
        const hit = CATS.find(([, re]) => re.test(e.title));
        if (!hit) continue;
        const cat = hit[0];
        if (PRO_RE.test(e.title) && !['Technique', 'Training'].includes(cat)) continue;
        const views = +(e.raw.match(/views="(\d+)"/) || [])[1] || 0;
        const likes = +(e.raw.match(/starRating[^>]*count="(\d+)"/) || [])[1] || 0;
        vids.push({ title: e.title, link: `https://www.youtube.com/watch?v=${vid}`, source: c.name, date: new Date(Date.parse(e.date) || Date.now()).toISOString(), cat, kind: 'Video', views, likes, thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` });
        n++;
      }
      status.sources[key] = { ok: true, items: n };
    } catch (e) { status.sources[key] = { ok: false, error: String(e.message || e) }; }
  }
  await writeFile(new URL('channels.json', OUT), JSON.stringify(cache, null, 1));
  vids.sort((a, b) => b.date.localeCompare(a.date));
  return vids;
}

// ---------- ESPN scoreboards ----------
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
function slimEspn(j, tour) {
  const events = [];
  for (const ev of j.events || []) {
    const e = { id: ev.id, name: ev.name || ev.shortName, start: ev.date, end: ev.endDate, tour, city: ev.venue?.address?.city || ev.venue?.fullName || '', matches: [] };
    for (const g of ev.groupings || [{ competitions: ev.competitions || [] }]) {
      const draw = g.grouping?.displayName || g.grouping?.name || '';
      if (/doubles/i.test(draw)) continue;
      for (const c of g.competitions || []) {
        const st = c.status?.type || {};
        const players = (c.competitors || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(p => ({
          name: p.athlete?.displayName || p.athlete?.shortName || p.team?.displayName || 'TBD',
          country: p.athlete?.flag?.alt || '',
          winner: !!p.winner,
          sets: (p.linescores || []).map(l => ({ g: l.value, tb: l.tiebreak })),
        }));
        e.matches.push({ id: c.id, date: c.date || c.startDate, state: st.state || '', detail: st.shortDetail || st.detail || st.description || '', completed: !!st.completed, round: c.round?.displayName || c.notes?.[0]?.text || '', court: c.venue?.court || c.venue?.fullName || '', draw, players });
      }
    }
    events.push(e);
  }
  // season calendar for the in-app freshness comparison
  const cal = [];
  for (const L of j.leagues || []) for (const x of L.calendar || []) {
    if (x && typeof x === 'object' && (x.startDate || x.start)) cal.push({ name: x.label || x.name || '', start: x.startDate || x.start, end: x.endDate || x.end || '' });
  }
  return { events, calendar: cal };
}

async function buildEspn() {
  const out = { generatedAt: status.generatedAt, events: [], calendar: { ATP: [], WTA: [] } };
  const today = new Date();
  const days = [-1, 0, 1].map(o => ymd(new Date(today.getTime() + o * 864e5)));
  for (const tour of ['ATP', 'WTA']) {
    const key = 'espn-' + tour.toLowerCase();
    try {
      const byId = new Map();
      let ok = 0;
      for (const q of ['', ...days.map(d => '?dates=' + d)]) {
        try {
          const j = await get(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour.toLowerCase()}/scoreboard${q}`, { json: true });
          ok++;
          const s = slimEspn(j, tour);
          if (!out.calendar[tour].length && s.calendar.length) out.calendar[tour] = s.calendar;
          for (const ev of s.events) {
            const prev = byId.get(ev.id);
            if (!prev) byId.set(ev.id, ev);
            else { const ids = new Set(prev.matches.map(m => m.id)); for (const m of ev.matches) if (!ids.has(m.id)) prev.matches.push(m); else prev.matches[prev.matches.findIndex(x => x.id === m.id)] = m; }
          }
        } catch {}
      }
      if (!ok) throw new Error('no scoreboard responses');
      // keep only events still running or finished within 2 days
      const keep = [...byId.values()].filter(ev => !ev.end || Date.parse(ev.end) > Date.now() - 2 * 864e5);
      out.events.push(...keep);
      status.sources[key] = { ok: true, events: keep.length, matches: keep.reduce((n, e) => n + e.matches.length, 0) };
    } catch (e) { status.sources[key] = { ok: false, error: String(e.message || e) }; }
  }
  return out;
}

// ---------- main ----------
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
async function main() {
await mkdir(OUT, { recursive: true });
const [news, videos, espn] = [await buildNews(), await buildVideos(), await buildEspn()];
await writeFile(new URL('news.json', OUT), JSON.stringify({ generatedAt: status.generatedAt, items: news }));
await writeFile(new URL('videos.json', OUT), JSON.stringify({ generatedAt: status.generatedAt, items: videos.slice(0, 200) }));
await writeFile(new URL('espn.json', OUT), JSON.stringify(espn));
await writeFile(new URL('status.json', OUT), JSON.stringify(status, null, 1));
console.log(JSON.stringify(status, null, 1));
}
