// 推薦／最新：綜合好樂迪、錢櫃兩家 KTV 的排行，再用 KKBOX 的排行補到 100 首
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const dec = s => { try { return decodeURIComponent(s || ''); } catch (e) { return String(s || ''); } };
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const safe = p => timeout(p, 8000).catch(() => []);

// 各語言在三個來源的代號
const LANG = {
  c: { hdTop: 'tc', hdHotNew: 'nc', hdNew: 'c', cb: '01', kk: 297 },
  t: { hdTop: 'tt', hdHotNew: 'nt', hdNew: 't', cb: '02', kk: 304 },
  g: { hdTop: 'ct', hdNew: 'g', cb: '03', kk: 320 },
  w: { hdTop: 'et', hdNew: 'w', cb: '05', kk: 390 },
  j: { hdTop: 'jt', hdNew: 'j', cb: '04', kk: 308 },
  k: { hdTop: 'kt', hdNew: 'k', kk: 314 },
};

// 好樂迪：點播排行（top）、新進歌曲（new），一頁 20 首
async function holiday(m, ltype, maxPages) {
  const page = async p => {
    const r = await fetch('https://www.holiday.com.tw/Ashx/SongInfo.ashx', { method: 'POST', body: JSON.stringify([{ m, ltype, page: p }]),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', 'User-Agent': UA, 'Referer': 'https://www.holiday.com.tw/SongInfo/SongList.aspx' } });
    const j = (await r.json())[0] || {};
    return { list: j.DataList || [], max: ((j.Page || [])[0] || {}).MaxPage || 1 };
  };
  const first = await page(1), n = Math.min(first.max, maxPages);
  const rest = await Promise.all([...Array(Math.max(0, n - 1))].map((_, i) => page(i + 2).then(x => x.list).catch(() => [])));
  return first.list.concat(...rest).map(x => ({ title: dec(x.songname), singer: dec(x.singer) })).filter(x => x.title);
}

// 錢櫃：bl t=2 點播排行、t=1 新歌排行；sn5 列出最近 5 批新進日期，sn 拿某一批
async function cashbox(body) {
  const r = await fetch('https://www.cashboxparty.com/ashx/ah_Song.ashx', { method: 'POST', body: JSON.stringify([body]),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', 'User-Agent': UA, 'Referer': 'https://www.cashboxparty.com/Music/KTVMusic.aspx' } });
  const a = await r.json();
  return Array.isArray(a) ? a.filter(x => x.Result === '0' && x.SongName) : [];
}
const cbList = (a, lang) => a.filter(x => x.LangCode === lang).map(x => ({ title: x.SongName, singer: x.Singer }));
async function cashboxNew(lang) {
  const dates = [];
  const r = await fetch('https://www.cashboxparty.com/ashx/ah_Song.ashx', { method: 'POST', body: JSON.stringify([{ m: 'sn5' }]),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', 'User-Agent': UA, 'Referer': 'https://www.cashboxparty.com/Music/KTVMusic.aspx' } });
  for (const x of await r.json()) if (x.InDate) dates.push(x.InDate);
  const batches = await Promise.all(dates.map(d => cashbox({ m: 'sn', lang, date: d }).catch(() => [])));
  return batches.flat().map(x => ({ title: x.SongName, singer: x.Singer }));
}

// KKBOX：熱門（song）與新歌（newrelease）日榜，各 50 首
async function kkbox(type, category) {
  const r = await fetch(`https://kma.kkbox.com/charts/api/v1/daily?category=${category}&lang=tc&limit=50&terr=tw&type=${type}`, { headers: { 'User-Agent': UA } });
  const j = await r.json();
  const list = (j.data && j.data.charts && (j.data.charts.song || j.data.charts.newrelease)) || [];
  return list.map(x => ({ title: x.song_name, singer: x.artist_name }));
}

// KKBOX 的歌名常帶副標（「甲乙丙丁Strangers - 你我怎麼兩清」「必巡 (三立戲劇…)」），整理成 KTV 那種乾淨的歌名
function cleanTitle(t) {
  let s = String(t || '').split(/\s+-\s+/)[0].replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').trim();
  if (/[㐀-鿿]/.test(s)) s = s.replace(/[A-Za-z][A-Za-z' .&!?]*$/, '').trim() || s; // 中文歌名後面接的英文名拿掉
  return s;
}
// 歌手名：中文名後面接的英文名拿掉（「蕭秉治Xiao Bing Chih」→「蕭秉治」），純英文名不動
const cleanSinger = s => String(s || '').replace(/\s*[（(][^）)]*[）)]/g, '').split(/\s*,\s*/).slice(0, 2)
  .map(n => /[㐀-鿿]$|[㐀-鿿]\s*[A-Za-z][A-Za-z' .]*$/.test(n) ? n.replace(/([㐀-鿿])\s*[A-Za-z][A-Za-z' .]*$/, '$1').trim() : n).join('、').trim();
const key = t => cleanTitle(t).toLowerCase().replace(/[\s'"’.,，、!！?？~～·・-]/g, '');

// 推薦：每個清單照名次給分（第 1 名最高），好幾家都排很前面的歌加起來最高
function mergeRanked(sources, limit) {
  const map = new Map();
  for (const { name, list, weight } of sources) {
    const done = new Set(); // 同一首歌在同一個清單只算一次（同一首有不同歌手的版本）
    list.forEach((x, i) => {
      const k = key(x.title); if (!k || done.has(k)) return; done.add(k);
      const pts = weight * (1 - i / Math.max(list.length, 30)) + weight * 0.3;
      const cur = map.get(k) || { title: cleanTitle(x.title), singer: cleanSinger(x.singer), score: 0, src: [] };
      cur.score += pts; if (!cur.src.some(s => s.startsWith(name))) cur.src.push(name + ' ' + (i + 1));
      map.set(k, cur);
    });
  }
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    .map((x, i) => ({ rank: i + 1, title: x.title, singer: x.singer, src: x.src.join('・') }));
}
// 最新：各來源輪流拿（每家的清單本來就是越新越前面），重複的跳過
function mergeRoundRobin(sources, limit) {
  const seen = new Map(), out = [];
  const max = Math.max(0, ...sources.map(s => s.list.length));
  for (let i = 0; i < max && out.length < limit; i++) for (const { name, list } of sources) {
    const x = list[i]; if (!x) continue;
    const k = key(x.title); if (!k) continue;
    if (seen.has(k)) { const o = seen.get(k); if (!o.src.includes(name)) o.src.push(name); continue; }
    const o = { title: cleanTitle(x.title), singer: cleanSinger(x.singer), src: [name] }; seen.set(k, o); out.push(o);
    if (out.length >= limit) break;
  }
  return out.map((x, i) => ({ rank: i + 1, title: x.title, singer: x.singer, src: x.src.join('・') }));
}

export async function combinedChart(m, lang) {
  const L = LANG[lang] || LANG.c;
  if (m === 'top') {
    const [hd, cbTop, hdNew, cbNew, kk] = await Promise.all([
      safe(holiday('top', L.hdTop, 2)),
      L.cb ? safe(cashbox({ m: 'bl', t: '2', lang: L.cb }).then(a => cbList(a, L.cb))) : [],
      L.hdHotNew ? safe(holiday('top', L.hdHotNew, 2)) : [],
      L.cb && (L.cb === '01' || L.cb === '02') ? safe(cashbox({ m: 'bl', t: '1', lang: L.cb }).then(a => cbList(a, L.cb))) : [],
      safe(kkbox('song', L.kk)),
    ]);
    return mergeRanked([
      { name: '好樂迪', list: hd, weight: 3 }, { name: '錢櫃', list: cbTop, weight: 3 },
      { name: '好樂迪新歌榜', list: hdNew, weight: 1.5 }, { name: '錢櫃新歌榜', list: cbNew, weight: 1.5 },
      { name: 'KKBOX', list: kk, weight: 1 },
    ], 100);
  }
  const [hd, cb, kk] = await Promise.all([
    safe(holiday('new', L.hdNew, 5)),
    L.cb === '01' || L.cb === '02' ? safe(cashboxNew(L.cb)) : [],
    safe(kkbox('newrelease', L.kk)),
  ]);
  return mergeRoundRobin([{ name: '好樂迪', list: hd }, { name: '錢櫃', list: cb }, { name: 'KKBOX', list: kk }], 100);
}
