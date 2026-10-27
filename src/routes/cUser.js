const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { getAccessToken } = require('../services/wxService');
const guard = require('../services/contentGuard');

/**
 * C端用户自助（小程序「我的」页）
 * 鉴权：X-User-Id + X-User-Token，由挂载层统一挂 requireUser（见 src/app.js）
 * 接口：GET /me、POST /profile、POST /bind-phone、POST /avatar
 */

const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024; // 1.5MB

// GET /api/c/user/me 当前用户资料
router.get('/me', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nickname, u.avatar_url, u.phone, u.company_name, u.source, u.created_at,
              u.role, u.factory_id, f.name AS factory_name
       FROM c_end_user u LEFT JOIN factory f ON f.id = u.factory_id
       WHERE u.id = ?`,
      [req.user.id]
    );
    if (!rows.length) throw new Error('用户不存在');
    const u = rows[0];
    res.json(ok({
      id: u.id,
      nickname: u.nickname,
      avatarUrl: u.avatar_url,
      phone: u.phone,
      companyName: u.company_name,
      devMode: u.source === 'dev',
      createdAt: u.created_at,
      // 绑定关系现值（mine 页工厂身份卡依据；绑定变化后由前端同步本地缓存）
      role: u.role || 'customer',
      factoryId: u.factory_id || null,
      factoryName: u.factory_name || null,
    }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/c/user/profile 更新资料 { nickname?, companyName? }（F-103：公司信息随资料维护）
router.post('/profile', async (req, res) => {
  try {
    const { nickname, companyName } = req.body || {};
    if (nickname === undefined && companyName === undefined) throw new Error('缺少要更新的参数');
    const sets = [];
    const params = [];
    if (nickname !== undefined) {
      const nick = String(nickname).trim();
      if (nick.length > 30) throw new Error('昵称不能超过 30 个字');
      sets.push('nickname = ?');
      params.push(nick || null);
    }
    if (companyName !== undefined) {
      const company = String(companyName).trim();
      if (company.length > 50) throw new Error('公司名称不能超过 50 个字');
      sets.push('company_name = ?');
      params.push(company || null);
    }
    // 内容安全：昵称与公司名称均对外展示（工厂端与订单可见）
    await guard.assertTextAllowed([
      { label: '昵称', value: nickname },
      { label: '公司名称', value: companyName },
    ], { openid: req.user.openid, scene: 'profile' });
    params.push(req.user.id);
    await pool.query('UPDATE c_end_user SET ' + sets.join(', ') + ' WHERE id = ?', params);
    res.json(ok({ updated: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/c/user/bind-phone 绑定手机号
// 正式环境（已配置微信密钥）：{ code }（getPhoneNumber 回调换取）
// 开发降级（未配置密钥）：{ phone } 直接校验绑定
router.post('/bind-phone', async (req, res) => {
  try {
    const { code, phone: rawPhone } = req.body || {};
    const hasWxKey = !!(process.env.WX_APPID && process.env.WX_SECRET);
    let phone = null;

    if (hasWxKey) {
      // 正式环境不允许直接提交手机号（防伪造），必须走微信 code 换取
      if (!code) throw new Error('请在微信中授权获取手机号');
      const accessToken = await getAccessToken();
      const wxRes = await fetch(
        'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=' + encodeURIComponent(accessToken),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }
      );
      const data = await wxRes.json();
      if (data.errcode !== 0 || !data.phone_info) {
        throw new Error('获取手机号失败：' + (data.errmsg || ('errcode ' + data.errcode)));
      }
      phone = data.phone_info.purePhoneNumber || data.phone_info.phoneNumber || '';
    } else {
      // 开发降级：手动输入手机号
      phone = String(rawPhone || '').trim();
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error('手机号格式不正确（需 11 位）');
    await pool.query('UPDATE c_end_user SET phone = ? WHERE id = ?', [phone, req.user.id]);
    res.json(ok({ phone }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/c/user/avatar 上传头像 { dataUrl: 'data:image/png;base64,...' }
// 存至 uploads/avatars/，静态托管 /uploads（见 src/app.js），仅保留最新一张
router.post('/avatar', async (req, res) => {
  try {
    const { dataUrl } = req.body || {};
    const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new Error('图片格式不正确（仅支持 png/jpg/gif/webp）');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) throw new Error('图片内容为空');
    if (buf.length > MAX_AVATAR_BYTES) throw new Error('图片不能超过 1.5MB');

    fs.mkdirSync(AVATAR_DIR, { recursive: true });
    const fname = 'u' + req.user.id + '_' + Date.now() + '.' + ext;
    fs.writeFileSync(path.join(AVATAR_DIR, fname), buf);
    const url = '/uploads/avatars/' + fname;

    // 记录旧头像用于清理（仅清理本服务头像目录内的文件）
    const [rows] = await pool.query('SELECT avatar_url FROM c_end_user WHERE id = ?', [req.user.id]);
    const old = rows.length ? rows[0].avatar_url : null;
    await pool.query('UPDATE c_end_user SET avatar_url = ? WHERE id = ?', [url, req.user.id]);
    if (old && old.startsWith('/uploads/avatars/')) {
      try { fs.unlinkSync(path.join(AVATAR_DIR, path.basename(old))); } catch (e) { /* 旧文件不存在则忽略 */ }
    }
    res.json(ok({ avatarUrl: url }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

module.exports = router;
