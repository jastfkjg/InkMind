// Local-only, in-memory UI smoke fixture. Never connects to a database or LLM.
// Run: node tests/ui-fixture.mjs
// Then: VITE_API_URL=http://127.0.0.1:18991 npm run dev -- --host 127.0.0.1 --port 5198
import { createServer } from 'node:http';

const demo = process.argv.includes('--demo');
const user = { id: 901, email: 'writer@example.invalid', display_name: demo ? '南枝' : '测试作者', preferred_llm_provider: 'fixture', token_quota: null, preview_before_save: true };
const novel = { id: 901, user_id: 901, title: demo ? '山海来信' : '长篇测试作品：山海之间与归途的故事', genre: '奇幻', background: demo ? '群山之间，旧驿路连接着一座会遗忘的城。年轻的修信师林照沿着失落的邮路，寻找一封寄给明天的信。' : '一座山城和两位远行者。', writing_style: '细腻、克制，以日常细节铺陈奇幻气息', created_at: '2026-09-01T10:00:00', updated_at: '2026-09-04T10:00:00' };
const makeChapter = (id, title, content) => ({ id, novel_id: 901, title, summary: demo ? '林照收到一封日期写着明天的信，循着盐粒和旧地图，寻找山城遗忘的海。' : '主人公重返山城，发现旧友留下的信。', content, sort_order: id, created_at: novel.created_at, updated_at: novel.updated_at });
let chapters = [makeChapter(901, '山城来信', Array.from({ length: 40 }, (_, i) => `　　第${i + 1}段。雨落在石阶上，远方的灯火渐渐亮了起来。她收起信，沿着熟悉的小巷往前走。`).join('\n')), makeChapter(902, '归途', '　　城门在晨光中缓缓打开。')];
if (demo) {
  chapters = [
    makeChapter(901, '山城来信', [
      '雨停的时候，林照在门缝里发现了一封信。',
      '信封是旧式的青灰色，边角磨得发白，邮戳却清晰得像刚刚落下。她把它举到窗边，看见日期写着明天。',
      '山城的九月总是潮湿。屋檐滴下的水落进陶缸，一声接着一声；对面的面馆掀开蒸笼，白汽沿着石阶往上爬。所有事情都循着旧日的顺序，只有这封信来早了一天。',
      '她翻过信封。收信人一栏没有姓名，只有一句很轻的话：',
      '“请交给还记得海的人。”',
      '林照已经很久没有听人提起海了。老人们说，山城从来没有通向海的路；可父亲留下的地图上，那条蓝线一直穿过群山，停在纸张破损的边缘。',
      '她抽出信纸。里面夹着一片薄薄的银杏叶，叶脉之间嵌着细小的白色颗粒。她用指尖捻起一点，迟疑着尝了尝。',
      '是盐。',
      '楼下传来自行车铃声。送信的老人站在巷口，没有像往常那样把车靠在墙上。他抬头望着她的窗户，仿佛已经等了许多年。',
      '“今天别走北门。”他说。',
      '林照握着信纸，忽然听见很远的地方，有潮水涌上石阶。',
    ].map(p => `　　${p}`).join('\n\n')),
    makeChapter(902, '失落的驿路', '　　城门在晨光中缓缓打开。林照背起父亲留下的邮袋，第一次踏上地图之外的路。'),
    makeChapter(903, '寄给明天', '　　抵达旧驿站时，墙上的钟正停在雨落下之前。'),
    makeChapter(904, '听潮的人', '　　守灯人说，每一封没有送达的信，都会变成海上的一盏灯。'),
  ];
}
const writes = [];
let failSaves = false;
let delay = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5198');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept-Language');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let text = '';
  for await (const chunk of req) text += chunk;
  const body = text ? JSON.parse(text) : {};
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (path === '/__test/control') { failSaves = body.failSaves ?? failSaves; delay = body.delay ?? delay; json({ failSaves, delay }); return; }
  if (path === '/__test/state') { json({ chapters, writes }); return; }
  if (path === '/auth/login') { json({ access_token: 'local-fixture-only', user }); return; }
  if (path === '/auth/me') { json(user); return; }
  if (path === '/auth/quota') { json({ token_quota: null, token_quota_used: 0 }); return; }
  if (path === '/novels') { json(demo ? [novel,
    { ...novel, id: 905, title: '长街灯未眠', genre: '都市', background: '一家深夜营业的旧书店，收藏着城市里尚未说完的故事。', updated_at: '2026-09-03T20:30:00' },
    { ...novel, id: 906, title: '第七次日出', genre: '科幻', background: '远航船上的植物学家，在一颗没有黎明的星球上培育第一粒种子。', updated_at: '2026-09-02T09:15:00' },
  ] : [novel]); return; }
  if (path === '/novels/901') { json(novel); return; }
  if (path === '/meta/llm-providers') { json({ builtin: [{ id: 'fixture', label: 'Local fixture', models: ['fixture'], default_model: 'fixture' }], default: 'fixture', custom_llms: [], agent_builtin: null }); return; }
  if (path === '/novels/901/chapters' && req.method === 'GET') { json(chapters); return; }
  if (path === '/novels/901/chapters' && req.method === 'POST') { const ch = makeChapter(Math.max(...chapters.map(c => c.id)) + 1, body.title || '', body.content || ''); chapters.push(ch); json(ch); return; }
  if (path === '/novels/901/chapters/generate') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ t: '　　AI 测试片段。' }) + '\n');
    await wait(1500);
    res.end(JSON.stringify({ preview: { title: 'AI 预览标题', summary: body.summary, content: '　　AI 预览正文，确认前不可保存。', needs_revision: false } }) + '\n'); return;
  }
  if (path === '/novels/901/chapters/confirm-generation') {
    const ch = chapters.find(c => c.id === body.chapter_id); Object.assign(ch, { title: body.title, summary: body.summary, content: body.content }); json(ch); return;
  }
  const match = path.match(/^\/novels\/901\/chapters\/(\d+)$/);
  if (match) {
    const ch = chapters.find(c => c.id === Number(match[1]));
    if (req.method === 'PATCH') {
      writes.push({ chapterId: ch.id, ...body, failed: failSaves });
      await wait(delay);
      if (failSaves) { json({ detail: '测试网络错误：请重试' }, 503); return; }
      Object.assign(ch, { title: body.title, summary: body.summary, content: body.content }); json(ch); return;
    }
    if (req.method === 'DELETE') { chapters = chapters.filter(c => c !== ch); json({}); return; }
    json(ch); return;
  }
  if (/versions$/.test(path)) { json([{ id: 1, chapter_id: 902, version_number: 1, title: '归途', summary: '', content: '　　历史正文。', change_type: 'manual', created_at: novel.created_at }]); return; }
  if (path.includes('rollback')) { const ch = chapters.find(c => c.id === Number(path.split('/')[4])); Object.assign(ch, { content: '　　历史正文。' }); json(ch); return; }
  if (path.endsWith('/characters') || path.endsWith('/memos') || path === '/custom-llms' || path === '/background-tasks') { json([]); return; }
  if (path.startsWith('/usage')) { json({ total_calls: 0, builtin_total_tokens: 0, custom_total_tokens: 0, items: [] }); return; }
  json({ detail: `No fixture for ${path}` }, 404);
}).listen(18991, '127.0.0.1', () => console.log('Isolated UI fixture on http://127.0.0.1:18991'));
