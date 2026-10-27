/**
 * 行业资讯 RSS 抓取服务
 * 无外部依赖，使用原生 fetch + 正则解析 RSS XML。
 */
const { pool } = require('../config/db');

// 默认 RSS 源列表（可通过 sys_kv.news_sources 覆盖）
const DEFAULT_SOURCES = [
  { name: '科印网', url: 'https://www.keyin.cn/rss' },
  { name: '必胜印刷网', url: 'https://www.bisihq.com/rss' },
  { name: '印刷技术协会', url: 'https://www.ptia.org.cn/feed' },
];

async function getSources() {
  // 优先级：环境变量 NEWS_RSS_SOURCES > sys_kv.news_sources > DEFAULT_SOURCES
  const env = (process.env.NEWS_RSS_SOURCES || '').trim();
  if (env) {
    try { return JSON.parse(env); } catch (e) { console.warn('[news] NEWS_RSS_SOURCES 不是有效 JSON，回退默认'); }
  }
  try {
    const [rows] = await pool.query("SELECT v FROM sys_kv WHERE k = 'news_sources'");
    if (rows.length) return JSON.parse(rows[0].v);
  } catch (e) { /* 表不存在时使用默认 */ }
  return DEFAULT_SOURCES;
}

/** 解析单条 RSS <item> */
function parseItem(xml) {
  const title = (/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s.exec(xml) || [])[1] || '';
  const link = (/<link>(.*?)<\/link>/s.exec(xml) || [])[1] || '';
  const desc = (/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s.exec(xml) || [])[1] || '';
  const pubDate = (/<pubDate>(.*?)<\/pubDate>/s.exec(xml) || [])[1] || '';
  return {
    title: title.trim().slice(0, 300),
    url: link.trim().slice(0, 500),
    summary: desc.replace(/<[^>]+>/g, '').trim().slice(0, 500),
    publishedAt: pubDate ? new Date(pubDate) : null,
  };
}

/** 抓取单个源 */
async function crawlSource(source) {
  if (!source.url) return 0;
  let inserted = 0;
  try {
    const res = await fetch(source.url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return 0;
    const xml = await res.text();
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    for (const itemXml of items.slice(0, 30)) {
      const item = parseItem(itemXml);
      if (!item.title || !item.url) continue;
      try {
        await pool.query(
          `INSERT IGNORE INTO industry_news (title, summary, source_name, source_url, category, published_at)
           VALUES (?,?,?,?,?,?)`,
          [item.title, item.summary, source.name, item.url, guessCategory(item.title), item.publishedAt]
        );
        inserted++;
      } catch (e) { /* duplicate key, skip */ }
    }
  } catch (e) {
    console.warn('[news] 抓取失败', source.name, e.message);
  }
  return inserted;
}

/** 简单标题关键词分类 */
function guessCategory(title) {
  if (/政策|法规|标准|监管|通知/.test(title)) return 'policy';
  if (/技术|设备|数码|AI|智能|自动化/.test(title)) return 'tech';
  if (/纸|材料|油墨|供应|涨价|价格/.test(title)) return 'material';
  return 'market';
}

/** 抓取所有源 */
async function crawlAll() {
  const sources = await getSources();
  let total = 0;
  const perSource = [];
  for (const s of sources) {
    const n = await crawlSource(s);
    total += n;
    perSource.push({ name: s.name, inserted: n });
  }
  if (total) console.log('[news] 抓取完成，新增', total, '条');
  return { total, sources: sources.length, perSource };
}

module.exports = { crawlAll, getSources };
