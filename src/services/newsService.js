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

/**
 * 035 订阅资讯每日推送（早报/晚报）：
 *  - 按分类拉当日最新 3 条，拼接后调 wxService.notifyUser 下发
 *  - templateId 从环境变量 NEWS_SUBSCRIBE_TEMPLATE_ID 读；未配置静默降级
 *  - 仅推 enabled=1 且已绑定 openid 的订阅者；未授权微信一次性订阅会返 43101 静默失败
 */
async function pushDigest(category) {
  const templateId = (process.env.NEWS_SUBSCRIBE_TEMPLATE_ID || '').trim();
  if (!templateId) return { skipped: true, reason: 'no_template' };
  const wx = require('./wxService');
  if (!wx.isWxConfigured()) return { skipped: true, reason: 'no_wx_config' };

  const [news] = await pool.query(
    `SELECT id, title, summary, published_at FROM industry_news
     WHERE category = ? AND published_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     ORDER BY featured DESC, published_at DESC LIMIT 3`,
    [category]
  );
  if (!news.length) return { skipped: true, reason: 'no_news' };

  const [users] = await pool.query(
    `SELECT ue.openid FROM user_news_subscription uns
     JOIN c_end_user ue ON ue.id = uns.user_id
     WHERE uns.category = ? AND uns.enabled = 1 AND ue.openid IS NOT NULL AND ue.openid <> ''`,
    [category]
  );
  if (!users.length) return { skipped: true, reason: 'no_subscribers' };

  const CAT_LABEL = { policy: '政策', market: '市场', tech: '技术', material: '材料' };
  const catLabel = CAT_LABEL[category] || category;
  let sent = 0;
  for (const u of users) {
    const r = await wx.sendSubscribe(u.openid, templateId, {
      page: 'pages/news/news',
      data: {
        thing1: { value: (catLabel + ' · ' + news[0].title).slice(0, 20) },
        thing2: { value: (news[0].summary || news[0].title).slice(0, 20) },
        time3:  { value: new Date().toLocaleString('zh-CN', { hour12: false }) },
      },
    }).catch(() => ({ sent: false }));
    if (r && r.sent) sent++;
  }
  console.log('[news] 订阅推送完成 cat=' + category + ' 命中订阅者=' + users.length + ' 成功=' + sent);
  return { category, subscribers: users.length, sent };
}

module.exports = { crawlAll, getSources, pushDigest };
