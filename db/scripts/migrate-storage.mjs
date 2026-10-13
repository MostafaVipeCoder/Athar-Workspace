// Stage 2b storage migration (LOCAL ONLY). Re-runnable: uploads use x-upsert; asset_map rows are re-processed unless status = 'done'
// (pass --all to redo everything).  Env: SERVICE_ROLE_KEY (required), SHARP_DIR (dir with node_modules/sharp), API_URL (default local),
// DB_CONTAINER (default supabase_db_stack).
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL || 'http://127.0.0.1:54321';
const KEY = process.env.SERVICE_ROLE_KEY;
const CONT = process.env.DB_CONTAINER || 'supabase_db_stack';
if (!KEY) throw new Error('SERVICE_ROLE_KEY missing');
if (!/^supabase_db_/.test(CONT)) throw new Error('refusing non-local container');
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(API + '/')) throw new Error('refusing non-local API');
const sharp = createRequire(path.join(process.env.SHARP_DIR, 'x.js'))('sharp');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'local-db', 'export', 'storage', 'event-assets');
const ALL = process.argv.includes('--all');
const UA = 'Mozilla/5.0 (compatible; AtharMigration/1.0; local-migration)';
const MAX_DL = 25 * 1024 * 1024;

function psql(sql) {
  const r = spawnSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error('psql: ' + r.stderr);
  return r.stdout.trim();
}
const q = (s) => (s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");

async function upload(bucket, p, buf, ct) {
  const url = `${API}/storage/v1/object/${bucket}/${p.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': ct, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }, body: buf });
  if (!res.ok) throw new Error(`upload ${bucket}/${p}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
async function variants(buf) {
  const base = sharp(buf, { failOn: 'none' }).rotate();
  const full = await base.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const thumb = await base.clone().resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const fm = await sharp(full).metadata();
  return { full, thumb, w: fm.width, h: fm.height };
}
const thumbPath = (p) => p.replace(/\.webp$/, '_t.webp');

async function fetchImage(url) {
  let id = null, m;
  if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/)) || (m = url.match(/[?&]id=([\w-]+)/))) id = m[1];
  let cands;
  if (/drive\.google\.com/.test(url) && id) cands = [`https://drive.google.com/uc?export=download&id=${id}`, `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, `https://lh3.googleusercontent.com/d/${id}`];
  else cands = [url, url.replace(/=w\d+.*$/, '=w1600')];
  const why = [];
  for (const c of cands) {
    try {
      const res = await fetch(c, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.5' }, signal: AbortSignal.timeout(30000) });
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!res.ok) { why.push(`HTTP ${res.status}`); continue; }
      if (!ct.startsWith('image/')) { why.push(`not an image (${ct || 'no content-type'})`); continue; }
      const ab = await res.arrayBuffer();
      if (ab.byteLength > MAX_DL) { why.push('larger than 25 MB'); continue; }
      const buf = Buffer.from(ab);
      try { await sharp(buf, { failOn: 'none' }).metadata(); } catch { why.push('undecodable image'); continue; }
      return { buf, ct, url: c };
    } catch (e) { why.push(e.name === 'TimeoutError' ? 'timeout' : 'network error'); }
  }
  return { error: [...new Set(why)].join('; ') || 'no candidate' };
}

const rows = psql(`select coalesce(json_agg(json_build_object('o', old_path, 'b', bucket, 'n', new_path, 's', source, 'k', kind, 'st', status) order by old_path), '[]') from migration.asset_map where source in ('bucket','external')`);
const items = JSON.parse(rows).filter((r) => ALL || r.st !== 'done');
console.log('to process:', items.length);
let done = 0, failed = 0;
async function handle(r) {
  try {
    let orig, ct, fetchUrl = null, archive = null;
    if (r.s === 'bucket') {
      const f = path.join(SRC, ...r.o.split('/'));
      if (!existsSync(f)) throw new Error('source file missing in export');
      orig = readFileSync(f);
      if (r.b === 'resources') {
        await upload('resources', r.n, orig, 'application/pdf');
        psql(`insert into migration.asset_result(old_path,outcome,original_bytes,full_bytes,content_type) values (${q(r.o)},'done',${orig.length},${orig.length},'application/pdf') on conflict (old_path) do update set outcome='done',reason=null,attempted_at=now(),original_bytes=excluded.original_bytes,full_bytes=excluded.full_bytes,content_type=excluded.content_type;
          update migration.asset_map set status='done', note=null where old_path=${q(r.o)};`);
        done++; return;
      }
    } else {
      const g = await fetchImage(r.o);
      if (g.error) throw new Error(g.error);
      orig = g.buf; ct = g.ct; fetchUrl = g.url.replace(/id=[\w-]+/, 'id=<id>').replace(/\/d\/[\w-]+/, '/d/<id>');
      const ext = (ct.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
      archive = `external/${path.basename(r.n, '.webp')}.${ext}`;
      await upload('migration-archive', archive, orig, ct);
    }
    const v = await variants(orig);
    await upload(r.b, r.n, v.full, 'image/webp');
    await upload(r.b, thumbPath(r.n), v.thumb, 'image/webp');
    psql(`insert into migration.asset_result(old_path,outcome,fetch_url,content_type,original_bytes,full_bytes,thumb_bytes,width,height,archive_path) values (${q(r.o)},'done',${q(fetchUrl)},${q(ct || 'image/*')},${orig.length},${v.full.length},${v.thumb.length},${v.w},${v.h},${q(archive)}) on conflict (old_path) do update set outcome='done',reason=null,attempted_at=now(),fetch_url=excluded.fetch_url,content_type=excluded.content_type,original_bytes=excluded.original_bytes,full_bytes=excluded.full_bytes,thumb_bytes=excluded.thumb_bytes,width=excluded.width,height=excluded.height,archive_path=excluded.archive_path;
      update migration.asset_map set status='done', note=null, bytes=${orig.length} where old_path=${q(r.o)};`);
    done++;
  } catch (e) {
    failed++;
    psql(`insert into migration.asset_result(old_path,outcome,reason) values (${q(r.o)},'failed',${q(e.message)}) on conflict (old_path) do update set outcome='failed',reason=excluded.reason,attempted_at=now();
      update migration.asset_map set status='failed', note=${q(e.message)} where old_path=${q(r.o)};`);
  }
}
const queue = [...items];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await handle(queue.shift()); }));
console.log(`done=${done} failed=${failed}`);
