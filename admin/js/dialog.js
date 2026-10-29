/**
 * Stage11 统一弹框：样式化的 alert / confirm / prompt（Promise 化）
 * 背景：原生 confirm/prompt 与后台 UI 风格不搭配（浏览器会加上「localhost:6001 显示」标题）,
 *      且无法定制密码输入与多行文本。
 * 用法（均须在 async 函数内 await）：
 *   await ui.alert('已保存');
 *   if (!(await ui.confirm('确认删除？'))) return;
 *   const pwd = await ui.prompt('请输入新密码', '', { inputType: 'password' }); // 取消返回 null
 *   const txt = await ui.prompt('回复内容', '', { multiline: true, title: '回复工单' });
 * 同时 window.alert 被接管为 ui.alert，历史 alert() 调用自动换新样式。
 */
(function () {
  let maskEl = null;

  function ensureMask() {
    if (maskEl) return maskEl;
    maskEl = document.createElement('div');
    maskEl.className = 'ui-mask';
    document.body.appendChild(maskEl);
    return maskEl;
  }

  /**
   * 通用对话框
   * @param {Object} opts
   *  - title 标题；message 正文（支持 \n 换行）
   *  - input 是否带输入框；inputValue 初始值；placeholder；inputType（text/password）
   *  - buttons [{ label, className, pick: () => 返回值, cancel?: true }]
   */
  function show(opts) {
    return new Promise((resolve) => {
      const mask = ensureMask();
      mask.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'ui-dialog' + (opts.wide ? ' ui-dialog-wide' : '');

      if (opts.title) {
        const t = document.createElement('div');
        t.className = 'ui-dialog-title';
        t.textContent = opts.title;
        box.appendChild(t);
      }

      const msg = document.createElement('div');
      msg.className = 'ui-dialog-msg';
      String(opts.message == null ? '' : opts.message).split('\n').forEach((line, i) => {
        if (i) msg.appendChild(document.createElement('br'));
        msg.appendChild(document.createTextNode(line));
      });
      box.appendChild(msg);

      let inputEl = null;
      if (opts.input) {
        // input === 'textarea' 时出多行文本域（回复/备注/理由这类长文本）, 否则单行 input
        inputEl = document.createElement(opts.input === 'textarea' ? 'textarea' : 'input');
        inputEl.className = 'ui-dialog-input';
        if (opts.input !== 'textarea') inputEl.type = opts.inputType || 'text';
        else inputEl.rows = opts.rows || 4;
        inputEl.value = opts.inputValue || '';
        if (opts.placeholder) inputEl.placeholder = opts.placeholder;
        box.appendChild(inputEl);
      }

      const actions = document.createElement('div');
      actions.className = 'ui-dialog-actions';
      const buttons = opts.buttons || [];
      buttons.forEach((b) => {
        const btn = document.createElement('button');
        btn.className = 'btn ' + (b.className || 'btn-secondary');
        btn.textContent = b.label;
        btn.onclick = () => close(() => (b.pick ? b.pick(inputEl) : b.value));
        actions.appendChild(btn);
      });
      box.appendChild(actions);
      mask.appendChild(box);
      mask.style.display = 'flex';

      // 点遮罩 / Esc = 取消按钮的行为
      const cancelBtn = buttons.find((b) => b.cancel) || buttons[buttons.length - 1];
      function onMaskClick(e) {
        if (e.target === mask) close(() => (cancelBtn && cancelBtn.pick ? cancelBtn.pick(inputEl) : null));
      }
      function onKey(e) {
        if (e.key === 'Escape') close(() => (cancelBtn && cancelBtn.pick ? cancelBtn.pick(inputEl) : null));
        if (inputEl && document.activeElement === inputEl) {
          // 多行框里回车是换行, 只有 Ctrl+Enter 提交; 单行框仍为回车提交
          const multiline = inputEl.tagName === 'TEXTAREA';
          if (multiline && !(e.ctrlKey || e.metaKey)) return;
          if (!multiline && e.key !== 'Enter') return;
          const ok = buttons.find((b) => !b.cancel);
          if (ok) close(() => (ok.pick ? ok.pick(inputEl) : ok.value));
        }
      }
      function close(pick) {
        mask.removeEventListener('click', onMaskClick);
        window.removeEventListener('keydown', onKey);
        mask.style.display = 'none';
        mask.innerHTML = '';
        resolve(pick());
      }
      mask.addEventListener('click', onMaskClick);
      window.addEventListener('keydown', onKey);

      if (inputEl) {
        inputEl.focus();
        if (inputEl.select) inputEl.select();
      }
    });
  }

  const ui = {
    /** 提示框：点确定 resolve(true) */
    alert(message, title) {
      return show({
        title: title || '提示',
        message,
        buttons: [{ label: '确定', className: 'btn-primary', value: true }],
      });
    },
    /** 确认框：确定 resolve(true)，取消/遮罩/Esc resolve(false) */
    confirm(message, title) {
      return show({
        title: title || '请确认',
        message,
        buttons: [
          { label: '取消', className: 'btn-secondary', cancel: true, pick: () => false },
          { label: '确定', className: 'btn-primary', pick: () => true },
        ],
      });
    },
    /** 输入框：确定 resolve(输入值)，取消/遮罩/Esc resolve(null)；opts.inputType 可设 password，opts.multiline 出多行文本域 */
    prompt(message, defaultValue, opts) {
      const o = opts || {};
      return show({
        title: o.title || '请输入',
        message,
        input: o.multiline ? 'textarea' : true,
        rows: o.rows,
        wide: !!o.multiline,
        inputValue: defaultValue || '',
        placeholder: o.placeholder || '',
        inputType: o.inputType || 'text',
        buttons: [
          { label: '取消', className: 'btn-secondary', cancel: true, pick: () => null },
          { label: o.okLabel || '确定', className: 'btn-primary', pick: (inputEl) => inputEl.value },
        ],
      });
    },
  };

  window.ui = ui;
  // 接管原生 alert：全后台 alert() 调用自动换成统一样式（保持 undefined 返回值）
  window.alert = function (message) { ui.alert(String(message)); };
})();
