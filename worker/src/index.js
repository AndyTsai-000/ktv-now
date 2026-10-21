// 隨時唱 KTV 的搜尋代理：不用 YouTube API 金鑰，直接讀 YouTube 搜尋頁裡的 ytInitialData
const ok = (env, origin) => (env.APP_ORIGINS || '').split(',').some(o => o && origin === o.trim());

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  return ok(env, origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
}

function walk(node, out) {
  if (!node || typeof node !== 'object' || out.length >= 30) return;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return; }
  const v = node.videoRenderer;
  if (v && v.videoId) {
    const text = t => t ? (t.simpleText || (t.runs || []).map(r => r.text).join('')) : '';
    out.push({
      id: v.videoId,
      title: text(v.title),
      ch: text(v.ownerText || v.longBylineText),
      len: text(v.lengthText),
      views: text(v.shortViewCountText),
    });
    return;
  }
  for (const k in node) walk(node[k], out);
}

export async function search(q) {
  const url = 'https://www.youtube.com/results?hl=zh-TW&gl=TW&search_query=' + encodeURIComponent(q);
  const res = await fetch(url, { headers: {
    'Accept-Language': 'zh-TW,zh;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Cookie': 'CONSENT=YES+1; SOCS=CAI',
  } });
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s) || html.match(/ytInitialData"?\]?\s*=\s*(\{.*?\});/s);
  if (!m) throw new Error('parse');
  const out = [];
  walk(JSON.parse(m[1]), out);
  return out.filter(v => v.len); // 沒有長度的是直播
}

export default {
  async fetch(req, env, ctx) {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...h, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    const u = new URL(req.url);
    // 貼上 YouTube 網址時用來查歌名
    if (u.pathname === '/info' && h['Access-Control-Allow-Origin']) {
      const id = (u.searchParams.get('id') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 11);
      try {
        const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
        const j = await r.json();
        return Response.json({ id, title: j.title || '', ch: j.author_name || '' }, { headers: h });
      } catch (e) { return Response.json({ id, title: '', ch: '' }, { headers: h }); }
    }
    if (u.pathname !== '/search') return new Response('隨時唱 KTV 搜尋服務', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (!h['Access-Control-Allow-Origin']) return new Response('forbidden', { status: 403 });
    const q = (u.searchParams.get('q') || '').trim().slice(0, 80);
    if (!q) return Response.json([], { headers: h });
    // 同樣的關鍵字一天內直接用快取
    const key = new Request('https://cache.ktv/search?q=' + encodeURIComponent(q.toLowerCase()));
    const cache = caches.default;
    let hit = await cache.match(key);
    if (hit) return new Response(hit.body, { headers: { ...h, 'content-type': 'application/json' } });
    try {
      const list = await search(q);
      const body = JSON.stringify(list);
      if (list.length) ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'Cache-Control': 'max-age=86400' } })));
      return new Response(body, { headers: { ...h, 'content-type': 'application/json' } });
    } catch (e) {
      return Response.json({ error: '搜尋失敗' }, { status: 502, headers: h });
    }
  },
};
