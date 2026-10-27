/**
 * 021 设计排版服务（参数化模板渲染）
 * 思路：模板 = 画布 {w,h,bg} + 文字槽位 [{key,label,x,y,size,color,align,max}]（存 design_template.canvas）
 *       客户只填文字 → 服务端拼 SVG → @resvg/resvg-js 光栅化成高清 PNG 存 uploads/designs/。
 * 定位：排版「参考稿/效果稿」——文字清晰、尺寸可控，工厂接单后按此稿制版，
 *       比纯 AI 生图可靠（中文文字零错误），比人工设计快（30 秒出稿）。
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { pool } = require('../config/db');

let Resvg = null;
try {
  ({ Resvg } = require('@resvg/resvg-js'));
} catch (e) {
  console.warn('[designService] @resvg/resvg-js 未安装，模板渲染不可用（列表接口不受影响）');
}

let PDFDocument = null;
try {
  ({ PDFDocument } = require('pdfkit'));
} catch (e) {
  console.warn('[designService] pdfkit 未安装，印刷 PDF 不可用（PNG 渲染不受影响）');
}

const DESIGN_DIR = path.join(__dirname, '..', '..', 'uploads', 'designs');
fs.mkdirSync(DESIGN_DIR, { recursive: true });

const VALID_ALIGN = { left: 'start', center: 'middle', right: 'end' };

// ===== 024 制版规格 =====
// 出血 3mm/边、300dpi 光栅；PDF 为矢量文字（工厂可直接分色制版，无需重排）
const BLEED_MM = 3;
const PRINT_DPI = 300;
const mmToPx = (mm) => Math.round((mm / 25.4) * PRINT_DPI);
const mmToPt = (mm) => (mm / 25.4) * 72;

/** XML 文本转义（用户输入进 SVG 前必须转义，防注入也防断图） */
function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** hex 颜色 → CMYK（0-100 整数，pdfkit 色彩定义用） */
function hexToCmyk(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [0, 0, 0, 100];
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const c = (1 - r - k) / (1 - k);
  const y = (1 - g - k) / (1 - k);
  const mm = (1 - b - k) / (1 - k);
  const pct = (v) => Math.round(v * 100);
  return [pct(c), pct(y), pct(mm), pct(k)];
}

/**
 * 探测中文字体（PDF 矢量文字必须嵌入字体，否则工厂打开缺字）：
 * 优先级 环境变量 PDF_FONT_PATH → 项目 fonts/ 目录 → 系统常见路径。
 * ttc 集合需同时给出 postscript family 名（pdfkit doc.font(path, family)）。
 */
function findCjkFont() {
  if (process.env.PDF_FONT_PATH && fs.existsSync(process.env.PDF_FONT_PATH)) {
    return { path: process.env.PDF_FONT_PATH, family: process.env.PDF_FONT_FAMILY || ttcFamily(process.env.PDF_FONT_PATH) };
  }
  const fdir = path.join(__dirname, '..', '..', 'fonts');
  if (fs.existsSync(fdir)) {
    for (const f of fs.readdirSync(fdir)) {
      if (/\.(ttf|otf|ttc)$/i.test(f)) {
        return { path: path.join(fdir, f), family: ttcFamily(f) };
      }
    }
  }
  const sys = [
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\msyh.ttc',
    'C:\\Windows\\Fonts\\simsun.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/google-noto-cjk-sc/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
  ];
  for (const p of sys) {
    if (fs.existsSync(p)) return { path: p, family: ttcFamily(p) };
  }
  return null;
}

/** 常见 ttc 集合的 postscript 名映射（pdfkit 打开 ttc 必须指定） */
function ttcFamily(filePath) {
  const base = String(filePath).split(/[\\/]/).pop().toLowerCase();
  const map = {
    'msyh.ttc': 'MicrosoftYaHei',
    'msyhbd.ttc': 'MicrosoftYaHeiBold',
    'simsun.ttc': 'SimSun',
    'notosanscjk-regular.ttc': 'NotoSansCJKsc-Regular',
    'notosanscjk-bold.ttc': 'NotoSansCJKsc-Bold',
    'wqy-zenhei.ttc': 'WenQuanYiZenHei',
    'uming.ttc': 'AR PL UMing CN',
  };
  return map[base];
}

/** 按产品类型拉启用的模板列表（canvas 布局一并下发，小程序端据此做实时近似预览） */
async function listTemplates(productType) {
  const params = [];
  let sql = 'SELECT id, product_type, name, canvas, sort, size_w_mm, size_h_mm FROM design_template WHERE is_active = 1';
  if (productType) { sql += ' AND product_type = ?'; params.push(String(productType)); }
  sql += ' ORDER BY product_type, sort, id';
  const [rows] = await pool.query(sql, params);
  return rows.map((r) => {
    const canvas = typeof r.canvas === 'string' ? JSON.parse(r.canvas) : r.canvas;
    // 024 成品物理尺寸随模板下发（前端展示「按 300x400mm 出血出图」提示用）
    if (Number(r.size_w_mm) > 0 && Number(r.size_h_mm) > 0) {
      canvas.mm = { w: Number(r.size_w_mm), h: Number(r.size_h_mm) };
    }
    return {
      id: Number(r.id),
      productType: r.product_type,
      name: r.name,
      canvas,
    };
  });
}

/** 校验并取槽位文字（空必填报错、超长报错），返回 [{slot, raw, fontSize}] 或抛错 */
function resolveSlots(canvas, input) {
  const out = [];
  for (const slot of canvas.texts) {
    const raw = String(input[slot.key] == null ? '' : input[slot.key]).trim();
    if (!raw) {
      if (slot.key === 'title') throw new Error(`请填写「${slot.label}」`);
      continue;
    }
    const max = Math.max(1, parseInt(slot.max, 10) || 20);
    if (raw.length > max) throw new Error(`「${slot.label}」最多 ${max} 个字`);
    // 字号自适应：文字超画布宽 88% 时缩字号（CJK 字宽≈1em 粗算），与小程序预览端公式一致
    let fontSize = parseFloat(slot.size) || 40;
    fontSize = Math.min(fontSize, Math.floor((canvas.w * 0.88) / raw.length));
    out.push({ slot, raw, fontSize });
  }
  return out;
}

/**
 * 渲染模板 → 高清 PNG（+ 印刷 PDF）
 * 024 模板配置成品尺寸后：出血 3mm/边 @300dpi，逻辑坐标经 viewBox 等比映射，文字不变形；
 * 未配置尺寸的老模板维持原 1800x2400 逻辑稿输出。
 * @param {Object} input { templateId, texts: {key: value} }
 * @returns {Promise<{url, pdfUrl?, width, height, mm?}>}
 */
async function renderTemplate({ templateId, texts }) {
  if (!Resvg) throw Object.assign(new Error('排版渲染组件未安装'), { status: 503 });
  const id = parseInt(templateId, 10);
  if (!id) throw new Error('模板不存在');

  const [rows] = await pool.query(
    'SELECT id, name, canvas, size_w_mm, size_h_mm FROM design_template WHERE id = ? AND is_active = 1', [id]
  );
  if (!rows.length) throw new Error('模板不存在或已停用');
  const canvas = typeof rows[0].canvas === 'string' ? JSON.parse(rows[0].canvas) : rows[0].canvas;
  if (!canvas || !canvas.w || !canvas.h || !Array.isArray(canvas.texts)) {
    throw new Error('模板布局数据异常');
  }

  const sizeW = parseInt(rows[0].size_w_mm, 10) || 0;
  const sizeH = parseInt(rows[0].size_h_mm, 10) || 0;
  const hasSize = sizeW > 0 && sizeH > 0;

  const input = (texts && typeof texts === 'object') ? texts : {};
  const slots = resolveSlots(canvas, input);

  // 出血页参数：k=逻辑单位/mm（画布与成品等比配置），出血逻辑偏移 dx/dy
  let k = 0, dx = 0, dy = 0;
  if (hasSize) {
    k = canvas.w / sizeW;
    dx = BLEED_MM * k;
    dy = BLEED_MM * k;
  }
  const pageW = hasSize ? mmToPx(sizeW + BLEED_MM * 2) : canvas.w;
  const pageH = hasSize ? mmToPx(sizeH + BLEED_MM * 2) : canvas.h;
  const viewBox = hasSize
    ? `${-dx} ${-dy} ${canvas.w + dx * 2} ${canvas.h + dy * 2}`
    : `0 0 ${canvas.w} ${canvas.h}`;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}" viewBox="${viewBox}">`,
  ];
  // 出血框底色铺满整页（含出血位），内容区底色由模板原 rect 覆盖，两侧颜色一致则视觉无缝
  parts.push(hasSize
    ? `<rect x="${-dx}" y="${-dy}" width="${canvas.w + dx * 2}" height="${canvas.h + dy * 2}" fill="${escXml(canvas.bg || '#ffffff')}"/>`
    : `<rect width="${canvas.w}" height="${canvas.h}" fill="${escXml(canvas.bg || '#ffffff')}"/>`);
  // 装饰线（可选）：分隔标题区等，先于文字绘制垫底
  for (const ln of (Array.isArray(canvas.lines) ? canvas.lines : [])) {
    const x1 = parseFloat(ln.x) || 0;
    const x2 = parseFloat(ln.x2 != null ? ln.x2 : ln.x) || x1;
    const y = parseFloat(ln.y) || 0;
    const sw = Math.max(1, parseFloat(ln.width) || 6);
    parts.push(
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${escXml(ln.stroke || '#000000')}" `
      + `stroke-width="${sw}" stroke-linecap="round"${ln.opacity != null ? ` opacity="${parseFloat(ln.opacity)}"` : ''}/>`
    );
  }
  for (const { slot, raw, fontSize } of slots) {
    const anchor = VALID_ALIGN[slot.align] || 'middle';
    parts.push(
      `<text x="${parseFloat(slot.x) || 0}" y="${parseFloat(slot.y) || 0}" `
      + `font-size="${fontSize}" fill="${escXml(slot.color || '#000000')}" `
      + `text-anchor="${anchor}" font-family="sans-serif">${escXml(raw)}</text>`
    );
  }
  parts.push('</svg>');

  // 中文依赖系统字体（resvg 默认 loadSystemFonts：Linux 需装 fonts-noto-cjk；
  // Windows/macOS 开发机用系统中文字体），font-family=sans-serif 走 fontdb 回退链
  const png = new Resvg(parts.join(''), {
    background: canvas.bg || '#ffffff',
    fitTo: { mode: 'original' },
  }).render().asPng();

  // 结果区预览缩略图：真机上原图（300dpi 大图，数 MB http 局域网地址）加载慢且受域名校验影响
  // 易显示空白；缩到宽 700px 转 base64 内联，免网络加载即点即显，点击预览仍看原图
  let thumb = null;
  try {
    const tbuf = new Resvg(parts.join(''), {
      background: canvas.bg || '#ffffff',
      fitTo: { mode: 'width', value: 700 },
    }).render().asPng();
    thumb = 'data:image/png;base64,' + tbuf.toString('base64');
  } catch (e) {
    console.error('[designService] 缩略图渲染失败（不影响主流程）:', e.message);
  }

  const base = 'tpl_' + id + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const pngName = base + '.png';
  fs.writeFileSync(path.join(DESIGN_DIR, pngName), png);

  // 024 印刷 PDF：矢量文字 + CMYK + 裁切角线（仅配置了成品尺寸的模板产出）
  let pdfUrl = null;
  if (hasSize) {
    try {
      const pdfName = await renderPrintPdf({ canvas, slots, sizeW, sizeH, outBase: base });
      if (pdfName) pdfUrl = '/uploads/designs/' + pdfName;
    } catch (e) {
      // PDF 失败不阻断 PNG 主流程（PNG 可用），记日志便于排查字体问题
      console.error('[designService] 印刷 PDF 生成失败（PNG 已产出）:', e.message);
    }
  }

  const ret = { url: '/uploads/designs/' + pngName, width: pageW, height: pageH };
  if (thumb) ret.thumb = thumb;
  if (pdfUrl) {
    ret.pdfUrl = pdfUrl;
    ret.mm = { w: sizeW, h: sizeH };
  }
  return ret;
}

/**
 * 印刷 PDF（024 二档）：页面=成品+出血，文字矢量嵌入中文字体、CMYK 着色、
 * 四角裁切标记。工厂可直接用于分色制版，无需重排文字。
 */
async function renderPrintPdf({ canvas, slots, sizeW, sizeH, outBase }) {
  if (!PDFDocument) return null;
  const font = findCjkFont();
  if (!font) {
    console.error('[designService] 未找到中文字体，跳过 PDF 生成（可设 PDF_FONT_PATH）');
    return null;
  }

  const pw = mmToPt(sizeW + BLEED_MM * 2);
  const ph = mmToPt(sizeH + BLEED_MM * 2);
  const k = canvas.w / sizeW;                       // 逻辑单位/mm
  const dx = BLEED_MM * k, dy = BLEED_MM * k;       // 出血逻辑偏移
  const sx = pw / (canvas.w + dx * 2);              // pt/逻辑单位（x/y 等比）

  const doc = new PDFDocument({
    size: [pw, ph],
    margin: 0,
    info: { Title: `印刷制版文件 ${sizeW}x${sizeH}mm`, Author: '龙港印刷智能报价系统', Subject: '含出血与裁切标记，文字已嵌入可编辑' },
    autoFirstPage: true,
  });
  const outPath = path.join(DESIGN_DIR, outBase + '.pdf');
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  doc.registerFont('cjk', font.path, font.family);
  doc.font('cjk');

  // 出血页 + 内容区底色（CMYK）
  const bg = hexToCmyk(canvas.bg || '#ffffff');
  doc.save().rect(0, 0, pw, ph).fillColor(bg[0], bg[1], bg[2], bg[3]).fill().restore();
  doc.rect(dx * sx, dy * sx, canvas.w * sx, canvas.h * sx).fillColor(bg[0], bg[1], bg[2], bg[3]).fill();

  // 装饰线（CMYK 描边、圆头，与 PNG 一致）
  for (const ln of (Array.isArray(canvas.lines) ? canvas.lines : [])) {
    const x1 = (parseFloat(ln.x) || 0) + dx;
    const x2 = (parseFloat(ln.x2 != null ? ln.x2 : ln.x) || 0) + dx;
    const y = (parseFloat(ln.y) || 0) + dy;
    const sw = Math.max(1, parseFloat(ln.width) || 6) * sx;
    const cmyk = hexToCmyk(ln.stroke || '#000000');
    doc.save()
      .moveTo(x1 * sx, y * sx).lineTo(x2 * sx, y * sx)
      .lineWidth(sw).lineCap('round')
      .strokeColor(cmyk[0], cmyk[1], cmyk[2], cmyk[3])
      .stroke().restore();
  }

  // 文字（矢量、嵌入字体；SVG 的 y=baseline → pdfkit 的 top = baseline - ascent）
  for (const { slot, raw, fontSize } of slots) {
    const fsPt = fontSize * sx;
    doc.fontSize(fsPt);
    const ascent = (doc._font && doc._font.ascent) || 0.88;
    const top = ((parseFloat(slot.y) || 0) + dy) * sx - fsPt * ascent;
    const leftBase = (parseFloat(slot.x) || 0) + dx;
    const w = doc.widthOfString(raw);
    let left = leftBase * sx;
    if ((slot.align || 'center') === 'center') left -= w / 2;
    else if (slot.align === 'right') left -= w;
    const cmyk = hexToCmyk(slot.color || '#000000');
    doc.fillColor(cmyk[0], cmyk[1], cmyk[2], cmyk[3]).text(raw, left, top);
  }

  // 裁切角线：成品框四角，线长 5mm，距成品角 1.5mm 起，0.3pt 黑
  const bx = dx * sx, by = dy * sx;
  const bw = canvas.w * sx, bh = canvas.h * sx;
  const cl = mmToPt(5), gap = mmToPt(1.5);
  doc.save().lineWidth(0.3).strokeColor(0, 0, 0, 100);
  const corners = [
    [bx, by, -1, -1], [bx + bw, by, 1, -1], [bx, by + bh, -1, 1], [bx + bw, by + bh, 1, 1],
  ];
  for (const [cx, cy, sxn, syn] of corners) {
    doc.moveTo(cx + sxn * gap, cy).lineTo(cx + sxn * (gap + cl), cy);
    doc.moveTo(cx, cy + syn * gap).lineTo(cx, cy + syn * (gap + cl));
  }
  doc.stroke().restore();

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return outBase + '.pdf';
}

/**
 * AI 生成设计参考稿（021-b：对接服务器本机 new-api 的 agnes-image 渠道）
 * 定位：模板排版覆盖「文字型」需求；AI 生图覆盖「图案/插画/风格感觉」需求——
 *       客户只描述感觉，AI 出参考稿附到询价，工厂设计师照稿深化。
 * 流程：包装提示词 → POST {base}/images/generations → 拿 data[0].url →
 *       下载 PNG 落盘 uploads/designs/（与模板稿同目录同静态托管，URL 规则一致）。
 * 配置：AI_IMAGE_BASE_URL / AI_IMAGE_API_KEY / AI_IMAGE_MODEL（见 .env.example）
 */
const AI_BASE = (process.env.AI_IMAGE_BASE_URL || 'http://127.0.0.1:3000/v1').replace(/\/+$/, '');
const AI_KEY = process.env.AI_IMAGE_API_KEY || '';
const AI_MODEL = process.env.AI_IMAGE_MODEL || 'agnes-image-2.5-flash';
// 印刷参考稿风格后缀：约束构图/配色/背景，让产出更像「能印的东西」而非艺术照
const AI_PROMPT_SUFFIX = '。印刷品图案设计参考稿：平面插画风，主体居中构图饱满，配色不超过 5 种，纯色干净背景，边缘清晰无复杂渐变，适合丝网印刷/UV 打印工艺，画面完整不裁切';

async function generateAiImage(prompt) {
  const raw = String(prompt == null ? '' : prompt).trim();
  if (!raw) throw new Error('请先描述你想要的图案');
  if (raw.length > 200) throw new Error('描述最多 200 个字');
  if (!AI_KEY) throw Object.assign(new Error('AI 生图未配置（AI_IMAGE_API_KEY）'), { status: 503 });

  let resp;
  try {
    resp = await axios.post(
      AI_BASE + '/images/generations',
      { model: AI_MODEL, prompt: raw + AI_PROMPT_SUFFIX, n: 1, size: '1024x1024' },
      { headers: { Authorization: 'Bearer ' + AI_KEY, 'Content-Type': 'application/json' }, timeout: 120000 }
    );
  } catch (e) {
    const msg = e.response && e.response.data && e.response.data.error && e.response.data.error.message;
    throw new Error('AI 生图失败：' + (msg || e.message));
  }
  const item = resp.data && Array.isArray(resp.data.data) && resp.data.data[0];
  const url = item && (item.url || item.b64_json);
  if (!url) throw new Error('AI 生图失败：上游未返回图片');

  // 统一落盘为本站静态 URL（b64 直接解码；外链先下载再存，防止上游链接过期后询价单破图）
  let buf;
  if (item.b64_json) {
    buf = Buffer.from(item.b64_json, 'base64');
  } else {
    try {
      const img = await axios.get(item.url, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: 15 * 1024 * 1024 });
      buf = Buffer.from(img.data);
    } catch (e) {
      throw new Error('AI 图片下载失败：' + e.message);
    }
  }
  if (!buf.length || buf.length > 15 * 1024 * 1024) throw new Error('AI 图片数据异常');
  const fname = 'ai_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '.png';
  fs.writeFileSync(path.join(DESIGN_DIR, fname), buf);
  return { url: '/uploads/designs/' + fname };
}

/**
 * 制版能力自检（运维诊断用，P1 配套）：
 * 汇总启用模板的成品尺寸配置覆盖情况 + PDF 链路依赖（pdfkit/中文字体/resvg），
 * 返回「工厂可直接制版」的模板占比与阻塞项。
 */
async function templateRenderSummary() {
  const [rows] = await pool.query(
    'SELECT id, product_type, size_w_mm, size_h_mm FROM design_template WHERE is_active = 1'
  );
  const byProduct = {};
  let sized = 0;
  for (const r of rows) {
    const hasSize = Number(r.size_w_mm) > 0 && Number(r.size_h_mm) > 0;
    if (hasSize) sized++;
    const p = byProduct[r.product_type] || (byProduct[r.product_type] = { total: 0, printReady: 0 });
    p.total++;
    if (hasSize) p.printReady++;
  }
  const font = findCjkFont();
  return {
    total: rows.length,
    printReady: sized, // 配了成品尺寸→有印刷 PDF（工厂可直接制版）
    byProduct,
    deps: { resvg: !!Resvg, pdfkit: !!PDFDocument, cjkFont: font ? font.path : null },
  };
}

module.exports = { listTemplates, renderTemplate, generateAiImage, templateRenderSummary, DESIGN_DIR };
