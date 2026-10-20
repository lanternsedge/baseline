// Helper for the Baseline audio briefing (written by a scheduled Claude task).
//
//   node scripts/briefing.mjs plan          -> JSON: which edition this run is, whether today is a busy tennis day,
//                                              and whether an edition should be written at all.
//   node scripts/briefing.mjs add draft.json -> validates a draft edition and merges it into site/data/briefings.json
//                                              (newest first, keeps the last 4 days).
//
// Draft edition format:
// { "edition": "Morning"|"Midday"|"Evening", "intro": "optional spoken intro",
//   "stories": [ { "date":"YYYY-MM-DD", "source":"BBC Sport", "title":"...", "link":"https://...", "summary":"60-120 words, original wording" } ],
//   "outro": "optional spoken sign-off" }

import { readFile, writeFile } from 'node:fs/promises';

const DATA = new URL('../site/data/', import.meta.url);
const TZ = 'America/New_York';
const BIG = /masters 1000|wta 1000|year-end finals|grand slam/i;
const SLAM = /australian open|roland[- ]garros|french open|wimbledon|us open/i;

const etDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const etHour = (d = new Date()) => +new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d);
const words = s => (String(s || '').match(/\S+/g) || []).length;

async function readJSON(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, DATA), 'utf8')); } catch { return fallback; }
}

async function plan() {
  const today = etDate(), hour = etHour();
  const edition = hour < 10 ? 'Morning' : hour < 16 ? 'Midday' : 'Evening';
  const cal = await readJSON('calendar.json', { events: [] });
  const big = (cal.events || []).filter(e => e.start <= today && e.end >= today && (BIG.test(e.category) || SLAM.test(e.name)));
  const briefs = await readJSON('briefings.json', { editions: [] });
  const todays = (briefs.editions || []).filter(e => e.date === today);
  const already = todays.some(e => e.edition === edition);
  const busy = big.length > 0;
  const write = !already && (edition === 'Morning' || busy || todays.length === 0);
  const since = todays.map(e => e.publishedAt).sort().pop() || null;
  const out = {
    today, edition, busy,
    bigEvents: big.map(e => `${e.name} (${e.category})`),
    alreadyWritten: already,
    write,
    reason: already ? `The ${edition} edition already exists for today.` :
      write ? (edition === 'Morning' ? 'Morning edition runs every day.' : busy ? 'Busy tennis day, so extra editions run.' : 'No edition yet today, so this run catches up.') :
      'Quiet day: midday and evening editions are skipped.',
    since,
    sinceNote: since ? 'Cover only stories published or developed since this time; do not repeat stories already in today\'s editions.' : 'Cover roughly the last 24 hours (up to 48 on a quiet day).',
    storiesToday: todays.flatMap(e => e.stories.map(s => s.title)),
    targetStories: edition === 'Morning' || !since ? '10 to 14 stories, about 1,500 to 2,100 words in total' : '4 to 8 new stories, about 600 to 1,100 words in total',
  };
  console.log(JSON.stringify(out, null, 1));
}

async function add(file) {
  const draft = JSON.parse(await readFile(file, 'utf8'));
  const errs = [], warn = [];
  if (!['Morning', 'Midday', 'Evening'].includes(draft.edition)) errs.push('edition must be Morning, Midday or Evening');
  const stories = Array.isArray(draft.stories) ? draft.stories : [];
  if (!stories.length) errs.push('no stories');
  if (stories.length > 16) errs.push('more than 16 stories');
  stories.forEach((s, i) => {
    const n = `story ${i + 1}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) errs.push(`${n}: date must be YYYY-MM-DD`);
    if (!s.source) errs.push(`${n}: missing source`);
    if (!s.title) errs.push(`${n}: missing title`);
    if (!/^https:\/\//.test(s.link || '')) errs.push(`${n}: link must start with https://`);
    const w = words(s.summary);
    if (w < 40 || w > 170) errs.push(`${n}: summary is ${w} words (aim for 60-120)`);
    if (/["“”]/.test(s.summary || '') && (s.summary.match(/["“”][^"“”]{80,}["“”]/))) warn.push(`${n}: contains a long quotation; summaries should be in Baseline's own words`);
  });
  const total = words(draft.intro) + words(draft.outro) + stories.reduce((t, s) => t + words(s.title) + words(s.summary) + 8, 0);
  if (total > 2400) errs.push(`edition is ${total} words; keep it under about 2,200 (15 minutes)`);
  if (errs.length) { console.error('Draft rejected:\n- ' + errs.join('\n- ')); process.exit(1); }

  const today = etDate();
  const briefs = await readJSON('briefings.json', { editions: [] });
  const id = `${today}-${draft.edition.toLowerCase()}`;
  const ed = {
    id, date: today, edition: draft.edition, publishedAt: new Date().toISOString(),
    ...(draft.intro ? { intro: draft.intro } : {}),
    stories: stories.map(s => ({ date: s.date, source: s.source, title: s.title.trim(), link: s.link, summary: s.summary.trim() })),
    ...(draft.outro ? { outro: draft.outro } : {}),
  };
  const cutoff = etDate(new Date(Date.now() - 3 * 864e5));
  const editions = [ed, ...(briefs.editions || []).filter(e => e.id !== id && e.date >= cutoff)]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  await writeFile(new URL('briefings.json', DATA), JSON.stringify({ updated: ed.publishedAt, editions }, null, 1) + '\n');
  console.log(`Added ${id}: ${stories.length} stories, about ${total} words (~${Math.round(total / 155)} min).`);
  if (warn.length) console.log('Warnings:\n- ' + warn.join('\n- '));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'plan') await plan();
else if (cmd === 'add' && arg) await add(arg);
else { console.error('Usage: node scripts/briefing.mjs plan | add <draft.json>'); process.exit(2); }
