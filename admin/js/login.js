(function () {
  const mask = document.getElementById('login-mask');
  const input = document.getElementById('login-username');
  const pwdInput = document.getElementById('login-password');
  const btn = document.getElementById('login-btn');
  const errorEl = document.getElementById('login-error');

  // 统一登录（F-154）：单表单，服务端自动识别管理员 / 工厂身份，前端按 userType 落会话
  function showMask(msg) {
    if (msg) errorEl.textContent = msg;
    mask.style.display = 'flex';
    (input.value ? pwdInput : input).focus();
  }

  function hideMask() {
    mask.style.display = 'none';
    errorEl.textContent = '';
  }

  // 防重入：Enter 与按钮双通道都可能在网络慢时重复触发，
  // 重复登录会刷新服务端单会话令牌、把刚拿到的令牌顶掉，导致 reload 后 401「已过期」
  let loginRunning = false;

  async function tryLogin() {
    if (loginRunning) return;
    loginRunning = true;
    const username = (input.value || '').trim();
    const password = pwdInput.value || '';
    if (!username || !password) {
      errorEl.textContent = '请输入账号和密码';
      loginRunning = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = '登录中...';
    try {
      const data = await api.unifiedLogin(username, password);
      if (data.userType === 'factory') {
        // F-164/168：存角色与权限点，菜单按 staff:manage 等权限点渲染
        api.setFactoryAuth({
          factoryId: data.factoryId, code: data.code, name: data.name, token: data.token,
          role: data.role, permissions: data.permissions, factoryUserId: data.factoryUserId, realName: data.realName,
        });
        api.setLoginType('factory');
      } else {
        api.setToken(data.token);
        api.setLoginType('admin');
      }
      hideMask();
      location.reload();
    } catch (e) {
      errorEl.textContent = e.message || '登录失败';
      btn.disabled = false;
      btn.textContent = '登 录';
      loginRunning = false;
    }
  }

  btn.addEventListener('click', tryLogin);
  [input, pwdInput].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryLogin();
    });
  });

  // 任意接口返回 401：清除对应身份的本地令牌并弹出登录框
  window.addEventListener('admin-unauthorized', () => {
    if (api.getLoginType() === 'factory') {
      api.clearFactoryAuth();
    } else {
      api.clearToken();
    }
    showMask('登录已过期，请重新登录');
  });

  // 启动校验：按上次登录身份探测会话有效性；任何异常都弹出登录框，不再静默白屏。
  (async function boot() {
    try {
      const role = api.getLoginType();
      if (role === 'factory') {
        // 工厂会话探测：订单列表可读即令牌有效（requireFactory 把关）
        try {
          await api.factoryOrders();
        } catch (e) {
          api.clearFactoryAuth();
          showMask(e.code === 401 ? '登录已过期，请重新登录' : '');
        }
        return;
      }
      const token = localStorage.getItem('adminToken');
      if (!token) return showMask('');
      try {
        await api.adminMe();
      } catch (e) {
        api.clearToken();
        showMask('登录已过期，请重新登录');
      }
    } catch (err) {
      showMask('页面初始化异常，请重新登录');
    }
  })();

  // stage14：未捕获的 JS 错误（如 Vue 挂载失败）也兜底弹出登录框，避免空白页无提示
  window.addEventListener('error', (e) => {
    if (!mask.style.display || mask.style.display === 'none') {
      showMask('页面加载异常，请刷新或重新登录');
    }
  });
})();
