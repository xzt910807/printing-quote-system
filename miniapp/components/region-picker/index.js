// 地区选择弹层：省 / 市 / 区 三列联动（自建，不是系统的 <picker>）
// 为什么不用 <picker mode="multiSelector">：弹层是系统组件，里面字号、行高、列数一概改不了，
// 跟页面里 26~28rpx 的文字明显不是一个调子；而且只有省市两级时会出现两列都写「全部」的重复。
// 这里自建，字号 26rpx、行高 80rpx，两级时只画两列，「不限」只留在省列。
const REGIONS = require('../../utils/regions');

// 省列首项：选中表示不限地区（找厂筛选用），地址页不传 allow-all 就没有这一项
const ALL = '不限';
// 占位项：选了「不限」时市/区没有意义，显示一条短横线，不再重复写「不限」
const EMPTY = '—';

function clamp(n, max) {
  const v = Number(n) || 0;
  if (v < 0) return 0;
  return v >= max ? Math.max(0, max - 1) : v;
}

Component({
  properties: {
    show: { type: Boolean, value: false, observer: 'onShowChange' },
    // 2 = 省 + 市（找厂筛选用）；3 = 省 + 市 + 区（收货地址用）
    levels: { type: Number, value: 3 },
    // 省列是否带「不限」
    allowAll: { type: Boolean, value: false },
    // 回显用：传名字，如 ['浙江省', '温州市', '']，没选的留空
    value: { type: Array, value: [], observer: 'onValueChange' },
    title: { type: String, value: '选择地区' },
  },

  data: {
    // 三列的数据源；两级时第三列不渲染，但这里仍保留，省得各处判断长度
    range: [[], [], []],
    // 三列的选中下标（省列含「不限」时，0 表示不限）
    index: [0, 0, 0],
    // picker-view 的 value：必须与实际渲染的列数一致，两级时只给前两项
    viewValue: [0, 0],
  },

  methods: {
    onShowChange(v) { if (v) this.reopen(); },
    onValueChange() { if (this.data.show) this.reopen(); },

    // 按传入的名字反查下标，再据此重建三列
    reopen() {
      const names = this.data.value || [];
      const offset = this.data.allowAll ? 1 : 0;
      let sel = [0, 0, 0];
      if (names[0]) {
        const pIdx = REGIONS.findIndex((p) => p.name === names[0]);
        if (pIdx < 0) {
          sel = [0, 0, 0];
        } else {
          const cities = REGIONS[pIdx].children || [];
          let cIdx = names[1] ? cities.findIndex((c) => c.name === names[1]) : 0;
          if (cIdx < 0) cIdx = 0;
          const districts = (cities[cIdx] && cities[cIdx].children) || [];
          let dIdx = names[2] ? districts.indexOf(names[2]) : 0;
          if (dIdx < 0) dIdx = 0;
          sel = [pIdx + offset, cIdx, dIdx];
        }
      }
      this.apply(sel);
    },

    // 按下标组装三列（省/市变了以后，后面的下标可能越界，这里统一夹紧）
    apply(sel) {
      const allowAll = !!this.data.allowAll;
      const offset = allowAll ? 1 : 0;
      const provNames = REGIONS.map((p) => p.name);
      const col0 = allowAll ? [ALL].concat(provNames) : provNames;

      const pIdx = clamp(sel[0], col0.length) - offset;
      const p = pIdx >= 0 ? REGIONS[pIdx] : null;

      let col1 = [EMPTY];
      let col2 = [EMPTY];
      if (p) {
        col1 = (p.children || []).map((c) => c.name);
        const cIdx = clamp(sel[1], col1.length);
        col2 = ((p.children[cIdx] && p.children[cIdx].children) || []).slice();
        if (!col2.length) col2 = [EMPTY];
      }

      const index = [clamp(sel[0], col0.length), clamp(sel[1], col1.length), clamp(sel[2], col2.length)];
      this.setData({
        range: [col0, col1, col2],
        index,
        viewValue: this.data.levels >= 3 ? index.slice() : index.slice(0, 2),
      });
    },

    onChange(e) {
      const v = (e.detail && e.detail.value) || [];
      const prev = this.data.index;
      const next = [prev[0], prev[1], prev[2]];
      for (let i = 0; i < v.length && i < 3; i += 1) next[i] = v[i];
      // 省换掉：市、区都归零；市换掉：区归零
      if (next[0] !== prev[0]) { next[1] = 0; next[2] = 0; }
      else if (next[1] !== prev[1]) { next[2] = 0; }
      this.apply(next);
    },

    onConfirm() {
      const { range, index } = this.data;
      const isAll = this.data.allowAll && index[0] === 0;
      const pick = (list, i) => {
        const s = (list || [])[i];
        return s && s !== EMPTY ? s : '';
      };
      this.triggerEvent('confirm', {
        province: isAll ? '' : pick(range[0], index[0]),
        city: isAll ? '' : pick(range[1], index[1]),
        district: (isAll || this.data.levels < 3) ? '' : pick(range[2], index[2]),
      });
    },

    onCancel() { this.triggerEvent('cancel'); },

    // 面板内的空白处：挡住点击，别透到遮罩上把弹层关掉
    noop() {},
  },
});
