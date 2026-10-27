/**
 * 报价引擎核心用例测试（P1 防资损）
 * 运行：npm test（node --test）
 * 期望值推导口径：所有单价/费率来自 sql 种子数据（fixtures.js 同源解析），
 * 每处期望值注释给出「公式 → 代入 → 结果」，改种子价会同步失败，改公式逻辑会被抓住。
 */
const { test, before } = require('node:test');
const assert = require('node:assert');
const { loadFixtures } = require('./fixtures');
const { generateQuote } = require('../src/core/engine');
const { calcCartonArea, calcPaperBagArea, calcLidBaseArea, calcDrawerArea } = require('../src/core/paper');

before(() => { loadFixtures(); });

const EPS = 0.005;
function approx(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < EPS, (msg || '') + ' 期望 ' + expected + ' 实得 ' + actual);
}

/** 默认输入：纸箱/胶印/双坑BC/1000个，工厂 0（系统默认价：损耗4% 毛利15% 税10%） */
function quote(overrides) {
  return generateQuote(Object.assign({
    factoryId: 0, productType: 'carton', printMode: 'offset',
    lengthM: 0.3, widthM: 0.2, heightM: 0.15, quantity: 1000,
    materialType: 'boardPaper', materialCode: 'B_BC5',
    colorCount: 4, plateCode: 'CTP', processes: [],
  }, overrides));
}

// ===== 纯面积公式 =====
test('面积公式：纸箱（周长×高+糊口）', () => {
  approx(calcCartonArea({ lengthM: 0.3, widthM: 0.2, heightM: 0.15 }), 0.156); // (0.3+0.2)×2×0.15 + 0.04×0.15
});
test('面积公式：纸袋/无纺布袋展开', () => {
  // 展开宽=(袋宽+侧宽)×2+糊口=(0.25+0.15)×2+0.04=0.84；展开高=袋高+侧宽×0.5+翻口=0.3+0.075+0.05=0.425 → 0.357
  approx(calcPaperBagArea({ lengthM: 0.3, widthM: 0.25, heightM: 0.15 }), 0.357);
});
test('面积公式：天地盖/抽屉盒', () => {
  const lid = (0.2 + 0.1 * 2 + 0.02) * (0.15 + 0.1 * 2 + 0.02);
  const base = (0.2 - 0.001 + 0.2 + 0.015) * (0.15 - 0.001 + 0.2 + 0.015);
  approx(calcLidBaseArea({ lengthM: 0.2, widthM: 0.15, heightM: 0.1 }), Math.round((lid + base) * 1e4) / 1e4);
  const sideH = 0.21, sleeve = (0.2 + sideH + 0.04) * (0.15 + sideH + 0.04);
  const inner = (0.2 + 0.015) * (0.15 + 0.2 + 0.03);
  approx(calcDrawerArea({ lengthM: 0.2, widthM: 0.15, heightM: 0.1 }), Math.round((sleeve + inner) * 1e4) / 1e4);
});

// ===== 基础全链路（默认工厂价） =====
test('纸箱标准单：材料/版费/印工/税逐项核对', () => {
  const r = quote();
  // 面积 (0.3+0.2)×2×0.15 + 0.04×0.15 = 0.156 ㎡/个 × 1000 = 156 ㎡
  approx(r.areaPerUnit, 0.156, '单件面积');
  approx(r.totalArea, 156, '总面积');
  // 材料：156 × 1.85 × 1.04 = 300.14（B_BC5=1.85 元/㎡，损耗 4%）
  approx(r.breakdown.material.cost, 300.14, '材料费');
  // 版费：CTP 80 元/张 × 4 色 = 320
  approx(r.breakdown.plate.cost, 320, '版费');
  // 印工：胶印 startFee 800 + 0 加印，引擎默认 patternCover=mid → ×1.30 = 1040
  approx(r.breakdown.printing.cost, 1040, '印工');
  approx(r.breakdown.finishing.cost, 0, '后道');
  // 小计 1660.14 → unitCost 1.6601 → unitPrice 1.9091 → 税 10%
  approx(r.subtotal, 1660.14, '成本小计');
  approx(r.unitCost, 1.6601, '单件成本');
  approx(r.unitPrice, 1.9091, '单件报价（+15% 毛利）');
  approx(r.totalPrice, 1909.1, '不含税总价');
  approx(r.taxAmount, 190.91, '税额');
  approx(r.finalPrice, 2100.01, '含税总价');
});

test('参数覆盖：显式损耗/毛利/税率优先于工厂默认', () => {
  const r = quote({ wasteRate: 0.10, targetMargin: 0.20, taxRate: 0.06 });
  // 材料 156×1.85×1.10 = 317.46；印工仍 1040；小计 317.46+320+1040=1677.46
  approx(r.breakdown.material.cost, 317.46, '材料费');
  approx(r.subtotal, 1677.46);
  approx(r.unitCost, 1.6775, '单件成本');
  // ×1.2 = 2.013（round4）
  approx(r.unitPrice, 2.013, '单件报价');
});

// ===== 印工三参数（016） =====
test('图案覆盖率系数：low=×1.0 / high=×1.8', () => {
  // 柔印 perSqm：156㎡×1色×0.10=15.6 → 触底最低收费 300
  const low = quote({ printMode: 'flexo', colorCount: 1, processes: [], patternCover: 'low' });
  approx(low.breakdown.printing.cost, 300, 'low 档触底 min_charge');
  const high = quote({ printMode: 'flexo', colorCount: 1, processes: [], patternCover: 'high' });
  approx(high.breakdown.printing.cost, 540, 'high 档 300×1.8');
});

test('油墨系数：UV=×1.30（触底后仍可上浮）', () => {
  const r = quote({ printMode: 'flexo', colorCount: 1, processes: [], patternCover: 'low', inkType: 'UV' });
  approx(r.breakdown.printing.cost, 390, '300×1.0×1.3');
});

test('专色加价：版费不随专色变，印工基础×mid1.3 +350/色', () => {
  const r = quote({ spotColors: 2 });
  approx(r.breakdown.printing.cost, 1740, '800×1.3 + 2×350');
  approx(r.breakdown.plate.cost, 320, 'CTP 仅按色数');
});

test('数码印 perUnit 模式：数量×5 元/件×mid1.3', () => {
  const r = quote({ printMode: 'digital' });
  approx(r.breakdown.printing.cost, 6500, '1000×5×1.3');
});

// ===== 拼版摊薄 =====
test('拼版 nUp=4：版费与印工各摊 1/4', () => {
  const r = quote({ nUp: 4 });
  approx(r.breakdown.plate.cost, 80, '320/4');
  approx(r.breakdown.printing.cost, 260, '1040/4');
  approx(r.subtotal, 300.14 + 80 + 260, '小计');
});

// ===== 后道 =====
test('后道三种计价模式 + 小批量上浮', () => {
  // 覆哑膜 perSqm：156×0.65×1.05 = 106.47
  const a = quote({ processes: ['MATTE_FILM'] });
  approx(a.breakdown.finishing.cost, 106.47, '覆哑膜');
  // 粘箱 perUnit：1000×0.08 = 80
  const b = quote({ processes: ['GLUE_BOX'] });
  approx(b.breakdown.finishing.cost, 80, '粘箱');
  // 烫金 perSqm_withPlate：156×0.85+350 = 482.60
  const c = quote({ processes: ['HOT_STAMP'] });
  approx(c.breakdown.finishing.cost, 482.60, '烫金');
  // 车缝 perUnit + 批量<3000 上浮 1.5：1000×0.5×1.5 = 750
  const d = quote({ productType: 'nonWovenBag', printMode: 'screen', materialType: 'cardPaper', materialCode: 'NW_80', processes: ['SEWING'] });
  approx(d.breakdown.finishing.cost, 750, '车缝小批量上浮');
});

test('未知后道编码被品类校验拒绝（已配置品类严格收窄）', () => {
  assert.throws(() => quote({ processes: ['NOT_A_PROCESS'] }), /不支持工艺/);
});

// ===== 品类联动校验（008/009） =====
test('品类校验：纸箱用凹印被拒 / 彩盒用丝印被拒', () => {
  assert.throws(() => quote({ printMode: 'gravure' }), /不支持该印刷方式/);
  assert.throws(() => quote({ productType: 'cardBox', materialType: 'cardPaper', materialCode: 'CARD250', heightM: 0, printMode: 'screen' }), /不支持该印刷方式/);
});
test('品类校验：材料越界被拒（纸箱用白卡 / 彩盒用双坑）', () => {
  assert.throws(() => quote({ materialCode: 'CARD250', materialType: 'cardPaper' }), /不能使用材料/);
});
test('品类校验：工艺越界被拒（纸箱穿绳）', () => {
  assert.throws(() => quote({ processes: ['ROPE'] }), /不支持工艺/);
});
test('数量与材料非法值', () => {
  assert.throws(() => quote({ quantity: 0 }), /数量必须大于0/);
  assert.throws(() => quote({ materialCode: 'B_XXX' }), /不能使用材料/);
  assert.throws(() => quote({ materialType: 'mystery' }), /未知材料类型/);
});

// ===== 软包装（薄膜按重量 + 固定费分摊） =====
test('软包装：双层薄膜材料成本与模具/刀模分摊', () => {
  const r = quote({
    productType: 'flexiblePackaging', printMode: 'gravure',
    lengthM: 0.4, widthM: 0.3, heightM: 0, quantity: 10000,
    materialType: 'plasticFilm', materialCode: 'PP_40', filmCodes: ['PP_40', 'PET_35'], filmLayers: 2,
    moldFee: 3000, knifeFee: 300, processes: ['LAMINATE', 'BAG_3SEAL'],
  });
  // PP_40 层：0.12㎡ ×40μm×0.91/1000 = 0.004368kg ×14.6 = 0.0638；PET_35：0.12×35×1.38/1000=0.005796kg ×16.5=0.0956
  const perUnit = 0.004368 * 14.6 + 0.005796 * 16.5;
  approx(r.breakdown.material.cost, Math.round(perUnit * 10000 * 1.04 * 100) / 100, '薄膜材料');
  // 凹印 startFee：1500 + 9×60 = 2040（10000 个 = 超出 9 千印）
  approx(r.breakdown.printing.cost, Math.round(2040 * 1.3 * 100) / 100, '凹印×mid 图案 1.3');
  // 复合 perSqm：1496×0.9×1.02=1373.33；制袋 perUnit 10000×0.06=600
  approx(r.breakdown.finishing.cost, Math.round((1373.33 + 600) * 100) / 100, '后道');
  approx(r.breakdown.fixed.cost, 3300, '模具+刀模');
  assert.match(r.breakdown.fixed.items[0].detail, /3000元 ÷ 10000个/);
});

// ===== 工厂价覆盖（多租户核心） =====
test('A 厂价格覆盖：纸板/开机费/覆膜费率三处生效', () => {
  const base = quote({ processes: ['MATTE_FILM'] });
  const f1 = quote({ factoryId: 1, processes: ['MATTE_FILM'] });
  // 纸板 1.74（vs 1.85）→ 材料 156×1.74×1.04=282.30
  approx(f1.breakdown.material.cost, 282.30, 'A厂纸板价');
  // 开机费 720（1000 个不加印）×mid1.3 → 936
  approx(f1.breakdown.printing.cost, 936, 'A厂开机费720×1.3');
  // 覆膜 rate 0.58：156×0.58×1.05=95.00
  approx(f1.breakdown.finishing.cost, 95.00, 'A厂覆膜费率');
  assert.equal(f1.breakdown.material.priceSource, 'factory');
  assert.equal(base.breakdown.material.priceSource, 'system');
  // 毛利也来自工厂：A 厂 15%
  approx(f1.targetMargin, 0.15);
});

// ===== 丝印（009 费率行 + 016 系数） =====
test('无纺布袋丝印单：startFee 100+25/千印 ×mid1.3，NW_80 材料', () => {
  const r = quote({
    productType: 'nonWovenBag', printMode: 'screen',
    lengthM: 0.35, widthM: 0.3, heightM: 0.1, quantity: 2000,
    materialType: 'cardPaper', materialCode: 'NW_80', colorCount: 1, processes: ['SEWING'],
  });
  // 展开宽=(0.3+0.1)×2+0.04=0.84；展开高=0.35+0.05+0.05=0.45 → 0.378㎡ ×2000=756㎡
  approx(r.totalArea, 756, '总面积');
  approx(r.breakdown.material.cost, Math.round(756 * 8.0 * 1.04 * 100) / 100, '无纺布 8 元/㎡');
  approx(r.breakdown.printing.cost, Math.round((100 + 25) * 1.3 * 100) / 100, '丝印 125×1.3');
  // 车缝 2000<3000 上浮：2000×0.5×1.5=1500
  approx(r.breakdown.finishing.cost, 1500, '车缝上浮');
});
