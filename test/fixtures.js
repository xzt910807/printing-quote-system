/**
 * 报价引擎测试夹具：直接解析 sql/init.sql（合并版·单一文件）里的种子 INSERT，
 * 灌进 catalogService 单例的内存结构——测试价格与生产初始化目录同源。
 * 不连数据库：catalogService/baseData 是纯内存对象，引擎计算不依赖 pool。
 *
 * 兼容两种 INSERT 风格：mysqldump 带列名 + Navicat 无列名（从 CREATE TABLE 推导列序）。
 */
const fs = require('fs');
const path = require('path');

const SQL_DIR = path.join(__dirname, '..', 'sql');
const catalog = require('../src/services/catalogService');

/** 顶层逗号切一项元组为值数组（引号内不切，反斜杠转义整体保留） */
function splitItems(tupleText) {
  const items = [];
  let quote = null, cur = '', depth = 0;
  for (let i = 0; i < tupleText.length; i++) {
    const ch = tupleText[i];
    if (quote) {
      if (ch === '\\') { cur += ch + (tupleText[i + 1] || ''); i++; continue; }
      if (ch === quote) {
        if (tupleText[i + 1] === quote) { cur += ch; i++; continue; }
        quote = null;
      }
      cur += ch; continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { items.push(parseValue(cur)); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') items.push(parseValue(cur));
  return items;
}

/** 单值解析：字符串去外层引号并反转义（mysqldump 反斜杠风格 + SQL 双写）；NULL→null；数字→Number */
function parseValue(raw) {
  const s = String(raw).trim();
  if ((s[0] === "'" && s[s.length - 1] === "'") || (s[0] === '"' && s[s.length - 1] === '"')) {
    return unescapeSql(s.slice(1, -1));
  }
  if (/^NULL$/i.test(s)) return null;
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

function unescapeSql(inner) {
  let out = '';
  for (let k = 0; k < inner.length; k++) {
    const ch = inner[k];
    if (ch === '\\') {
      const nx = inner[k + 1];
      if (nx === undefined) { out += '\\'; break; }
      switch (nx) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'b': out += '\b'; break;
        case '0': out += '\0'; break;
        case 'Z': out += '\x1a'; break;
        case '\\': out += '\\'; break;
        case "'": out += "'"; break;
        case '"': out += '"'; break;
        default: out += nx;
      }
      k++;
    } else if (ch === "'" && inner[k + 1] === "'") { out += "'"; k++; }
    else out += ch;
  }
  return out;
}

function indexBy(rows, key) {
  const map = {};
  for (const r of rows) map[r[key]] = r;
  return map;
}

/** MySQL JSON 列（dump 出为字符串）统一解析为数组，与 catalogService.parseJsonCol 同口径 */
function parseJsonCol(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}

/**
 * 从 CREATE TABLE 块中提取列名列表（顺序即 INSERT 无列名时的位置映射）。
 */
function columnsOf(sqlText, table) {
  // 定位 CREATE TABLE `table` ( ... ) ENGINE
  const re = new RegExp('CREATE TABLE\\s+`?' + table + '`?\\s*\\(([^]*?)\\)\\s*ENGINE', 'i');
  const m = re.exec(sqlText);
  if (!m) return null;
  const body = m[1];
  const cols = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    // 只取以反引号包裹的列定义行（跳过 PRIMARY KEY / UNIQUE / INDEX / CONSTRAINT）
    const cm = /^`(\w+)`\s/.exec(t);
    if (cm) cols.push(cm[1]);
  }
  return cols.length ? cols : null;
}

/**
 * 种子解析：兼容两种 INSERT 风格——
 *   A) mysqldump 带列名：INSERT INTO `t` (`c1`,`c2`) VALUES (…),(…);
 *   B) Navicat 无列名逐行：INSERT INTO `t` VALUES (…);
 * 对 B 自动从 CREATE TABLE 推导列序。
 */
function seedOf(sqlText, table) {
  // 尝试带列名格式
  const reWithCols = new RegExp('INSERT\\s+(?:IGNORE\\s+)?INTO\\s+`?' + table + '`?\\s*\\(([^)]*)\\)\\s*VALUES', 'i');
  const mWithCols = reWithCols.exec(sqlText);

  let cols;
  if (mWithCols && mWithCols[1].trim().startsWith('`')) {
    // 带列名格式
    cols = mWithCols[1].split(',').map((c) => c.trim().replace(/`/g, '')).filter(Boolean);
    let i = mWithCols.index + mWithCols[0].length;
    return parseTuples(sqlText, cols, i);
  }

  // 无列名格式（Navicat）
  cols = columnsOf(sqlText, table);
  if (!cols) throw new Error('种子未找到：' + table + '（无法从 CREATE TABLE 推导列名）');

  // 收集该表所有 INSERT 行
  const insertRe = new RegExp('INSERT\\s+(?:IGNORE\\s+)?INTO\\s+`?' + table + '`?\\s+VALUES\\s*\\(', 'gi');
  const rows = [];
  let match;
  while ((match = insertRe.exec(sqlText)) !== null) {
    // 从 '(' 之后开始解析元组
    const startIdx = match.index + match[0].length;
    const tupleRows = parseTuples(sqlText, cols, startIdx - 1);
    rows.push(...tupleRows);
  }
  if (!rows.length) throw new Error('种子未找到：' + table + '（init.sql 结构变化需同步测试夹具）');
  return rows;
}

/**
 * 从 sqlText[pos] 开始逐元组语义扫描 '(' … ')' ，列名与值按位置对齐成对象数组。
 * 遇到 ';' 或文本结束停止（支持单条 INSERT 含多行 VALUES）。 */
function parseTuples(sqlText, cols, pos) {
  let i = pos;
  while (i < sqlText.length && sqlText[i] !== '(') i++;
  const rows = [];
  while (i < sqlText.length) {
    let depth = 0, buf = '', quote = null;
    while (i < sqlText.length) {
      const ch = sqlText[i];
      if (quote) {
        if (ch === '\\') { buf += ch + (sqlText[i + 1] || ''); i += 2; continue; }
        if (ch === quote) {
          if (sqlText[i + 1] === quote) { buf += ch; i += 2; continue; }
          quote = null;
        }
        buf += ch; i++; continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; buf += ch; i++; continue; }
      if (ch === '(') { depth++; if (depth === 1) { i++; continue; } buf += ch; i++; continue; }
      if (ch === ')') { depth--; if (depth === 0) { i++; break; } buf += ch; i++; continue; }
      buf += ch; i++;
    }
    const vals = splitItems(buf);
    const row = {};
    cols.forEach((c, idx) => { row[c] = vals[idx]; });
    rows.push(row);
    while (i < sqlText.length && /[\s,]/.test(sqlText[i])) i++;
    if (i >= sqlText.length || sqlText[i] === ';') break;
  }
  return rows;
}

function loadFixtures() {
  const initSql = fs.readFileSync(path.join(SQL_DIR, 'init.sql'), 'utf8');
  const base = catalog.baseData;

  base.rawPaper = indexBy(seedOf(initSql, 'raw_paper'), 'code');
  base.boardPaper = indexBy(seedOf(initSql, 'board_paper'), 'code');
  base.cardPaper = indexBy(seedOf(initSql, 'card_paper'), 'code');
  base.plasticFilm = indexBy(seedOf(initSql, 'plastic_film'), 'code');
  base.fluteFactor = indexBy(seedOf(initSql, 'flute_factor'), 'flute');
  base.plateType = indexBy(seedOf(initSql, 'plate_type'), 'code');
  base.printingRate = indexOfPrintingRate(seedOf(initSql, 'printing_rate'));
  base.finishing = indexBy(seedOf(initSql, 'finishing_process'), 'code');
  base.inkType = indexBy(seedOf(initSql, 'ink_type'), 'code');

  // 产品类型联动配置：JSON 列解析为数组，键为 product_type（与 catalogService.loadAll 一致）
  base.productConfig = {};
  for (const row of seedOf(initSql, 'product_config')) {
    base.productConfig[row.product_type] = {
      productType: row.product_type,
      productName: row.product_name,
      printModes: parseJsonCol(row.allowed_print_modes),
      materials: parseJsonCol(row.allowed_materials),
      processes: parseJsonCol(row.allowed_processes),
      sortOrder: row.sort_order,
      showPatternCover: row.show_pattern_cover !== 0,
      showInkType: row.show_ink_type !== 0,
      showSpotColors: row.show_spot_colors !== 0,
    };
  }

  // 工厂默认参数（getFactory 按 id 索引，字段名与生产 SELECT * 一致）
  catalog.factories = indexBy(seedOf(initSql, 'factory'), 'id');

  // 工厂价格覆盖（多租户核心，键路径与 catalogService.loadAll 一致）
  catalog.factoryOverrides = {};
  for (const o of seedOf(initSql, 'factory_price_override')) {
    const fid = o.factory_id, t = o.target_type, c = o.target_code;
    if (!catalog.factoryOverrides[fid]) catalog.factoryOverrides[fid] = {};
    if (!catalog.factoryOverrides[fid][t]) catalog.factoryOverrides[fid][t] = {};
    if (!catalog.factoryOverrides[fid][t][c]) catalog.factoryOverrides[fid][t][c] = {};
    catalog.factoryOverrides[fid][t][c][o.field_name] = o.field_value;
  }
  catalog.loadedAt = new Date();
}

/**
 * 印工费率按 print_mode 索引；三档图案系数若数据缺失回退默认（1/1.3/1.8），与 printing.js 兜底一致。
 */
function indexOfPrintingRate(rows) {
  const map = {};
  for (const r of rows) {
    if (r.ink_factor_low == null) r.ink_factor_low = 1.00;
    if (r.ink_factor_mid == null) r.ink_factor_mid = 1.30;
    if (r.ink_factor_high == null) r.ink_factor_high = 1.80;
    map[r.print_mode] = r;
  }
  return map;
}

module.exports = { loadFixtures, catalog };
