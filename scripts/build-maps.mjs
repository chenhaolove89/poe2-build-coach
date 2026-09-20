// Build packages/data/maps.json from three sources.
//
//   PoB2 src/Data/WorldAreas.lua  -> the authoritative area registry: area code,
//                                    name, act, level, tags, boss varieties.
//                                    act=10 && isMap=true is the endgame set.
//   poe2wiki "List of maps"       -> biome, layout prose (Notes column), boss fallback.
//   poe2way atlas (recorded)      -> community navigation/backtracking ratings 1-4.
//
// The area code is the join key between the client log (`Generating level 79 area
// "MapDeforestation"`) and this table. Do NOT derive it from the map name: the code
// is not always Map + PascalCase(name) -- MapSavanna is "Savannah", MapVaalFoundry
// is "Molten Vault". Take it from WorldAreas.lua.
//
// Sources are cached under .tmp/maps-src/; pass --refresh to re-fetch.
//
// Usage: node scripts/build-maps.mjs [--refresh]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.tmp', 'maps-src');
const OUT = join(ROOT, 'packages', 'data', 'maps.json');
const REFRESH = process.argv.includes('--refresh');

const WORLD_AREAS_URL =
  'https://api.github.com/repos/PathOfBuildingCommunity/PathOfBuilding-PoE2/contents/src/Data/WorldAreas.lua?ref=dev';
const WIKI_LIST_URL =
  'https://www.poe2wiki.net/api.php?action=parse&page=List_of_maps&prop=wikitext&format=json';

async function cached(name, url, { raw = false } = {}) {
  const file = join(CACHE, name);
  if (existsSync(file) && !REFRESH) return readFileSync(file, 'utf8');
  mkdirSync(CACHE, { recursive: true });
  process.stderr.write(`fetching ${url}\n`);
  const res = await fetch(url, {
    headers: raw
      ? { Accept: 'application/vnd.github.raw', 'User-Agent': 'poe2-build-coach/scripts' }
      : { 'User-Agent': 'poe2-build-coach/scripts' },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}

// ---------------------------------------------------------------- PoB2 registry

function parseWorldAreas(src) {
  const entryRe = /worldAreas\["([^"]+)"\]\s*=\s*\{/g;
  const areas = [];
  let m;
  while ((m = entryRe.exec(src))) {
    const code = m[1];
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    const str = (k) => (body.match(new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`)) || [])[1] ?? null;
    const num = (k) => {
      const v = (body.match(new RegExp(`\\b${k}\\s*=\\s*([^,\\n]+)`)) || [])[1];
      return v == null ? null : Number(v.trim());
    };
    const bool = (k) => (body.match(new RegExp(`\\b${k}\\s*=\\s*(true|false)`)) || [])[1] === 'true';
    const list = (k) => {
      const mm = body.match(new RegExp(`\\b${k}\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
      return mm ? [...mm[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
    };
    areas.push({
      code,
      name: str('name'),
      baseName: str('baseName'),
      act: num('act'),
      isMap: bool('isMap'),
      isHideout: bool('isHideout'),
      bosses: list('bossVarieties'),
    });
  }
  return areas;
}

// Kinds are decided from the area code and base name, in this order. Everything the
// client can report is kept -- a kind is a filter, never a deletion, because the farm
// log may name any of these and the join has to succeed.
function kindOf(a) {
  if (a.isHideout || /Hideout/.test(a.baseName)) return 'hideout';
  if (/Precursor Tower/.test(a.baseName)) return 'tower';
  if (/Citadel/.test(a.baseName)) return 'citadel';
  if (/UberBoss|LeagueBoss|BossRush|Mothersoul/.test(a.code)) return 'boss';
  if (/^MapUnique/.test(a.code)) return 'unique';
  return 'map';
}

// --------------------------------------------------------------- poe2wiki table

function parseWikiMaps(wikitext) {
  const cut = wikitext.indexOf('===Quest areas===');
  const body = cut === -1 ? wikitext : wikitext.slice(0, cut);
  const rows = body.split(/\n\|-/).slice(1);

  // Split a table row on top-level "||" only: [[A|B]] and {{t|x}} contain single pipes.
  const splitCells = (row) => {
    const s = row.replace(/^\s*\|/, '');
    const out = [];
    let cur = '';
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const two = s.slice(i, i + 2);
      if (two === '[[' || two === '{{') { depth++; cur += two; i++; continue; }
      if (two === ']]' || two === '}}') { depth--; cur += two; i++; continue; }
      if (two === '||' && depth <= 0) { out.push(cur); cur = ''; i++; continue; }
      cur += s[i];
    }
    out.push(cur);
    return out;
  };
  const clean = (s) =>
    (s || '')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a)
      .replace(/<br\s*\/?>/g, ' / ')
      // {{c|mod|text}} wraps the actual text; other templates carry nothing readable.
      .replace(/\{\{c\|[^|]*\|([\s\S]*?)\}\}/g, '$1')
      .replace(/\{\{[^{}]*\}\}/g, '')
      .replace(/\{\{n\/a\}\}/gi, '')
      .replace(/'+/g, '')
      .replace(/\s*\n\s*/g, ' / ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^\/\s*|\s*\/$/g, '')
      .trim();

  const maps = [];
  for (const row of rows) {
    const cells = splitCells(row).map((x) => x.trim());
    if (!cells[0]) continue;
    const raw = (cells[0].match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/) || [])[1];
    if (!raw) continue;
    maps.push({
      name: clean(raw).replace(/\s*\(map\)$/, ''),
      biome: clean(cells[1]),
      boss: clean(cells[3]),
      note: clean(cells[4]),
    });
  }
  return maps;
}

// ------------------------------------------------------------------ layout rule

// The wiki's Notes column is prose; these are the phrasings that actually occur.
function layoutFromNote(note) {
  if (!note) return null;
  if (/linear/i.test(note)) return 'linear';
  if (/open area|open layout/i.test(note)) return 'open';
  if (/circular|loop layout|loop with/i.test(note)) return 'loop';
  if (/indoor|quadratic/i.test(note)) return 'maze';
  if (/tower/i.test(note)) return 'special';
  return null;
}

// ------------------------------------------------------------------------ build

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const worldAreas = parseWorldAreas(await cached('WorldAreas.lua', WORLD_AREAS_URL, { raw: true }));
const wikiText = await cached('listofmaps.json', WIKI_LIST_URL);
const wiki = parseWikiMaps(JSON.parse(wikiText).parse.wikitext['*']);

// poe2way ratings were captured by hand in an earlier pass; they are recorded here as
// an input rather than re-scraped (its atlas page is an RSC payload, not an API).
const poe2wayFile = join(CACHE, 'poe2way.json');
const poe2way = existsSync(poe2wayFile)
  ? JSON.parse(readFileSync(poe2wayFile, 'utf8')).maps
  : [];

const wikiByName = new Map(wiki.map((w) => [norm(w.name), w]));
const wayByName = new Map(poe2way.map((w) => [norm(w.name), w]));

const endgame = worldAreas.filter((a) => a.act === 10 && a.isMap);

const areas = endgame.map((a) => {
  let kind = kindOf(a);
  const w = wikiByName.get(norm(a.baseName)) || null;
  const way = wayByName.get(norm(a.baseName)) || null;

  // The wiki's note is the only source that says an area is a Precursor Tower: the
  // registry files Alpine Ridge, Bluff, Lost Towers, Mesa and Sinking Spire under
  // their own map names, so without this they sit in the farmable pool as if a
  // waystone could be rolled into them. Mesa's note spells out the tower mechanic
  // ("activate to clear the fog ... and obtain 1 Tablet"), which is what they are.
  if (kind === 'map' && /^tower\b/i.test(w?.note ?? '')) kind = 'tower';

  // Biome: the wiki lists every biome an area can roll; poe2way records the ones it was
  // seen with, duplicates included. Prefer the wiki, then de-duplicate poe2way's.
  // A cell may also say "Mountain or Faridun City" (Ravine can roll either), which is
  // two biomes, not one value -- leaving it whole made a filter chip no other area
  // could ever match.
  let biomes = [];
  if (w && w.biome) biomes = w.biome.split(/,| or /).map((s) => s.trim()).filter(Boolean);
  else if (way) biomes = [...new Set(way.biomes)];

  const layout =
    layoutFromNote(w?.note) ??
    (way && way.layout !== 'special' ? way.layout : null) ??
    (kind === 'map' ? 'unknown' : 'special');

  return {
    code: a.code,
    name: a.baseName,
    kind,
    layout,
    biomes,
    boss: a.bosses.join(' / ') || w?.boss || null,
    note: w?.note || null,
    navigation: way?.navigation ?? null,
    backtracking: way?.backtracking ?? null,
  };
});

// The wiki lists a few map areas that are not atlas maps -- Expedition logbook
// destinations, the Breach tower -- and one (Gothic City) the registry does not carry
// yet. Resolve them against the *full* registry so nothing the wiki lists is silently
// absent, and keep the kind honest rather than filing them as ordinary maps.
const allByName = new Map();
for (const a of worldAreas) {
  const k = norm(a.baseName);
  if (!allByName.has(k)) allByName.set(k, a);
}
const seenNames = new Set(areas.map((a) => norm(a.name)));
for (const w of wiki) {
  const key = norm(w.name);
  if (seenNames.has(key)) continue;
  const a = allByName.get(key);
  // A map with no layout note is `unknown`, not `special`: `special` is a claim about
  // the layout, and Gothic City's note ("only spawns near Iron Citadel") is a spawn
  // rule, not a layout.
  const resolvedKind = a == null || /^Map[A-Z]/.test(a.code) ? 'map' : 'event'
  const layout = layoutFromNote(w.note) ?? (resolvedKind === 'map' ? 'unknown' : 'special');
  const biomes = w.biome ? w.biome.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const way = wayByName.get(key) || null;
  areas.push({
    code: a?.code ?? null,
    name: w.name,
    // A Map* code is a map instance the atlas can open; ExpeditionLogBook_*,
    // ChayulaLeague_* and friends are destinations reached some other way, so they are
    // reported as events. An unresolved name is kept as a map because the wiki
    // describes it as one (Gothic City "only spawns near Iron Citadel").
    kind: resolvedKind,
    layout,
    biomes,
    boss: w.boss || null,
    note: w.note || null,
    navigation: way?.navigation ?? null,
    backtracking: way?.backtracking ?? null,
  });
  seenNames.add(key);
}

areas.sort((a, b) => a.name.localeCompare(b.name) || (a.code || '').localeCompare(b.code || ''));

const out = {
  source:
    'PoB2 WorldAreas.lua (area codes, boss varieties) + poe2wiki List of maps (biomes, layout notes) + poe2way atlas (navigation/backtracking ratings 1-4)',
  captured: new Date().toISOString().slice(0, 10),
  areas,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

// ------------------------------------------------------------------ validation

const count = (k) => areas.filter((a) => a.kind === k).length;
const withRatings = areas.filter((a) => a.navigation != null).length;
console.log(`wrote ${OUT}`);
console.log(`  areas ${areas.length}`);
console.log(
  `  kinds: map ${count('map')} | unique ${count('unique')} | boss ${count('boss')} | citadel ${count('citadel')} | tower ${count('tower')} | hideout ${count('hideout')} | event ${count('event')}`,
);
console.log(`  with ratings ${withRatings} | with biome ${areas.filter((a) => a.biomes.length).length} | with boss ${areas.filter((a) => a.boss).length}`);

const layouts = {};
for (const a of areas) layouts[a.layout] = (layouts[a.layout] || 0) + 1;
console.log(`  layouts: ${JSON.stringify(layouts)}`);

// Every row should carry an area code, because that code is the join key against the
// client log. A row without one cannot be matched to a real run -- report it loudly.
const noCode = areas.filter((a) => !a.code);
console.log(`  WITHOUT an area code (${noCode.length}): ${noCode.map((a) => a.name).join(', ') || 'none'}`);

const noLayout = areas.filter((a) => a.kind === 'map' && a.layout === 'unknown');
console.log(`  maps with no layout information (${noLayout.length} of ${count('map')})`);

// Duplicate base names are legitimate (four Merchant's Campsites, seven Precursor
// Towers); the table is keyed by code, so this is informational only.
const byName = {};
for (const a of areas) (byName[a.name] = byName[a.name] || []).push(a.code);
const dupes = Object.entries(byName).filter(([, v]) => v.length > 1);
console.log(`  duplicate names ${dupes.length}: ${dupes.map(([n, c]) => `${n} x${c.length}`).join(', ')}`);
