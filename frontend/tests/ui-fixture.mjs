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
const novels = demo ? [novel,
  { ...novel, id: 905, title: '长街灯未眠', genre: '都市', background: '一家深夜营业的旧书店。', updated_at: '2026-09-03T20:30:00Z' },
  { ...novel, id: 906, title: '第七次日出', genre: '科幻', background: '在没有黎明的星球上培育第一粒种子。', updated_at: '2026-09-02T09:15:00Z' },
] : [novel];
const chapterStore = new Map([[901, chapters], [905, []], [906, []]]);
const people = demo ? [{ id: 901, novel_id: 901, name: '林照', profile: '年轻的修信师，沿着失落的邮路寻找父亲。', notes: '知道银杏叶上的盐来自海。', created_at: novel.created_at, updated_at: novel.updated_at }] : [];
const memos = demo ? [{ id: 901, novel_id: 901, title: '北门与旧邮路', body: '老人提醒林照今天别走北门。后续在第三章回收这个伏笔。', created_at: novel.created_at, updated_at: novel.updated_at }] : [];
const writes = [];
const confirmations = [];
let failSaves = false, failMemos = false, delay = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
Object.assign(user, { agent_mode: 'flexible', max_llm_iterations: 10, max_tokens_per_task: 50000, enable_auto_audit: true, auto_audit_min_score: 60, ai_language: null });
const tasks = demo ? ['completed', 'failed', 'running'].map((status, i) => ({ id: i + 1, user_id: 901, novel_id: 901, task_type: 'single_chapter', status, title: ['旧驿站的来客', '失落的邮袋', '听潮的人'][i], summary: '演示任务', batch_count: 1, current_index: 1, completed_count: status === 'completed' ? 1 : 0, error_message: status === 'failed' ? '演示连接中断，请重试。' : null, progress_message: null, total_tokens: 1200, created_at: novel.created_at, started_at: novel.created_at, completed_at: status === 'completed' ? novel.updated_at : null, task_items: [] })) : [];

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
  if (path === '/__test/control') { failSaves = body.failSaves ?? failSaves; failMemos = body.failMemos ?? failMemos; delay = body.delay ?? delay; json({ failSaves, failMemos, delay }); return; }
  if (path === '/__test/state') { json({ chapters: chapterStore.get(901), novels, writes, confirmations, people, memos, user }); return; }
  if (path === '/auth/login') { json({ access_token: 'local-fixture-only', user }); return; }
  if (path === '/auth/me' || path === '/auth/me/ai-settings') { if (req.method === 'PATCH') Object.assign(user, body); json(user); return; }
  if (path === '/auth/quota' || path === '/admin/me/quota') { json({ token_quota: null, token_quota_used: 0 }); return; }
  if (path === '/novels') {
    if (req.method === 'POST') {
      const n = { ...novel, id: Math.max(...novels.map(n => n.id)) + 1, title: body.title, genre: '', background: '', writing_style: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      novels.push(n); chapterStore.set(n.id, body.create_first_chapter ? [{ ...makeChapter(n.id * 10, '', ''), novel_id: n.id, summary: '' }] : []); json(n, 201); return;
    }
    json(novels.map(n => { const list = chapterStore.get(n.id) || []; const recent = [...list].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]; return { ...n, chapter_count: list.length, total_words: list.reduce((sum, c) => sum + Array.from(c.content.replace(/\s/g, '')).length, 0), last_chapter_id: recent?.id ?? null, last_chapter_title: recent?.title ?? null, last_edited_at: recent && Date.parse(recent.updated_at) > Date.parse(n.updated_at) ? recent.updated_at : n.updated_at }; })); return;
  }
  if (path === '/meta/llm-providers') { json({ builtin: [{ id: 'fixture', label: 'Local fixture', models: ['fixture', 'fixture-other'], default_model: 'fixture' }], default: 'fixture', custom_llms: [], agent_builtin: null, generation_custom_llm_id: null, agent_custom_llm_id: null }); return; }
  if (path === '/background-tasks') { json(tasks); return; }
  if (path.startsWith('/background-tasks/')) { const task = tasks.find(t => t.id === Number(path.split('/')[2])); json(path.endsWith('/progress') ? { ...task, task_id: task.id, progress: .4 } : task); return; }
  if (path.startsWith('/usage')) { json({ total_calls: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0, builtin_calls: 0, builtin_input_tokens: 0, builtin_output_tokens: 0, builtin_total_tokens: 0, custom_calls: 0, custom_input_tokens: 0, custom_output_tokens: 0, custom_total_tokens: 0, items: [] }); return; }
  const novelId = Number(path.split('/')[2]);
  const currentNovel = novels.find(n => n.id === novelId);
  const currentChapters = chapterStore.get(novelId) || [];
  const route = path.replace(/^\/novels\/\d+/, '/novels/current');
  if (route === '/novels/current') { if (req.method === 'PATCH') { if (failSaves) { json({ detail: '测试网络错误：请重试' }, 503); return; } Object.assign(currentNovel, body); } if (req.method === 'DELETE') { novels.splice(novels.indexOf(currentNovel), 1); chapterStore.delete(novelId); json({}); return; } json(currentNovel); return; }
  if (route === '/novels/current/chapters') {
    if (req.method === 'POST') { const ch = { ...makeChapter(Math.max(novelId * 10, ...currentChapters.map(c => c.id)) + 1, body.title || '', body.content || ''), novel_id: novelId, summary: body.summary || '' }; currentChapters.push(ch); json(ch); return; }
    json(currentChapters); return;
  }
  if (route === '/novels/current/chapters/generate') {
    const ch = currentChapters.find(c => c.id === body.chapter_id);
    const proposal = ch.content ? ch.content.replace('雨停的时候', '风停的时候').replace('是盐。', '是海盐。') : '　　新的第一段。\n\n　　新的第二段。';
    const result = { title: 'AI 预览标题', summary: body.summary, content: proposal, needs_revision: false };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ t: proposal }) + '\n'); await wait(300);
    if (user.preview_before_save) res.end(JSON.stringify({ preview: result }) + '\n');
    else { Object.assign(ch, result); res.end(JSON.stringify({ chapter: ch }) + '\n'); }
    return;
  }
  if (route === '/novels/current/chapters/confirm-generation') {
    if (failSaves) { json({ detail: '测试网络错误：请重试' }, 503); return; }
    const ch = currentChapters.find(c => c.id === body.chapter_id); confirmations.push(body); Object.assign(ch, { title: body.title, summary: body.summary, content: body.content, updated_at: new Date().toISOString() }); json(ch); return;
  }
  const match = route.match(/^\/novels\/current\/chapters\/(\d+)$/);
  if (match) {
    const ch = currentChapters.find(c => c.id === Number(match[1]));
    if (req.method === 'PATCH') {
      writes.push({ chapterId: ch.id, ...body, failed: failSaves }); await wait(delay);
      if (failSaves) { json({ detail: '测试网络错误：请重试' }, 503); return; }
      Object.assign(ch, body, { updated_at: new Date().toISOString() }); json(ch); return;
    }
    if (req.method === 'DELETE') { currentChapters.splice(currentChapters.indexOf(ch), 1); json({}); return; }
    json(ch); return;
  }
  if (/versions$/.test(route)) { json([{ id: 1, chapter_id: Number(path.split('/')[4]), version_number: 1, title: '归途', summary: '', content: '　　历史正文。', change_type: 'manual', created_at: novel.created_at }]); return; }
  if (route.includes('compare')) { json({ diff_html: '<p>历史正文。</p>', diff_text: '历史正文。', added_count: 1, removed_count: 1, changed_count: 1 }); return; }
  if (route.includes('rollback')) { const ch = currentChapters.find(c => c.id === Number(path.split('/')[4])); Object.assign(ch, { content: '　　历史正文。' }); json(ch); return; }
  if (route.endsWith('/characters')) {
    if (req.method === 'POST') { if (failSaves) { json({ detail: '测试网络错误：请重试' }, 503); return; } const person = { id: Math.max(0, ...people.map(p => p.id)) + 1, novel_id: novelId, ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; people.push(person); json(person); return; }
    json(people.filter(p => p.novel_id === novelId)); return;
  }
  if (route.endsWith('/memos')) {
    if (req.method === 'POST') { if (failMemos) { json({ detail: '测试备忘保存失败' }, 503); return; } const memo = { id: Math.max(0, ...memos.map(m => m.id)) + 1, novel_id: novelId, ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; memos.push(memo); json(memo); return; }
    json(memos.filter(m => m.novel_id === novelId)); return;
  }
  const entryMatch = route.match(/^\/novels\/current\/(characters|memos)\/(\d+)$/);
  if (entryMatch) {
    const entries = entryMatch[1] === 'characters' ? people : memos;
    const entry = entries.find(item => item.id === Number(entryMatch[2]) && item.novel_id === novelId);
    if (!entry) { json({ detail: '未找到记录' }, 404); return; }
    if (req.method === 'PATCH') {
      if (entryMatch[1] === 'memos' ? failMemos : failSaves) { json({ detail: '测试网络错误：请重试' }, 503); return; }
      Object.assign(entry, body, { updated_at: new Date().toISOString() });
    }
    if (req.method === 'DELETE') { entries.splice(entries.indexOf(entry), 1); json({}); return; }
    json(entry); return;
  }
  if (path === '/custom-llms') { json([]); return; }
  if (route.endsWith('/agent/sessions')) { json({ session_id: 'fixture-session', novel_id: novelId, status: 'idle' }); return; }
  json({ detail: `No fixture for ${path}` }, 404);
}).listen(18991, '127.0.0.1', () => console.log('Isolated UI fixture on http://127.0.0.1:18991'));
