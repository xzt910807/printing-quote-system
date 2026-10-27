/**
 * F-105 语音识别服务（第三方 ASR 通道：讯飞语音听写 WebSocket v2）
 * 背景：个人主体小程序无法添加「微信同声传译」插件（89260），改走
 * 小程序原生录音（wx.getRecorderManager）→ 上传本服务 → 讯飞识别 → 文本回填。
 * 个体户主体开通后可切回插件通道（见 miniapp/pages/quote/quote.js 注释）。
 * 环境变量：XF_APP_ID / XF_API_KEY / XF_API_SECRET（讯飞开放平台-语音听写应用）
 */
const WebSocket = require('ws');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

const XF_APP_ID = process.env.XF_APP_ID;
const XF_API_KEY = process.env.XF_API_KEY;
const XF_API_SECRET = process.env.XF_API_SECRET;

function isConfigured() {
  return !!(XF_APP_ID && XF_API_KEY && XF_API_SECRET);
}

/** 讯飞 WebSocket 鉴权 URL（HMAC-SHA256 签名，有效期 5 分钟） */
function getAuthUrl() {
  const host = 'ws-api.xfyun.cn';
  const apiPath = '/v2/iat';
  const date = new Date().toUTCString();

  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${apiPath} HTTP/1.1`;
  const signature = crypto
    .createHmac('sha256', XF_API_SECRET)
    .update(signatureOrigin)
    .digest('base64');

  const authorizationOrigin = `api_key="${XF_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');

  return `wss://${host}${apiPath}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;
}

/** 任意录音格式 → 讯飞要求的 16kHz 单声道 16bit 小端 PCM */
function convertToPcm(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath + '.pcm';
    ffmpeg(inputPath)
      // 上传端固定为小程序 wx.getRecorderManager 的裸 PCM 流（16kHz 单声道 16bit 无文件头，
      // .pcm 不是自描述格式，不显式声明输入参数 ffmpeg 无法探测）
      .inputOptions(['-f', 's16le', '-ar', '16000', '-ac', '1'])
      .toFormat('s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => {
        reject(new Error(
          '音频格式转换失败（需安装 ffmpeg 并加入 PATH）：' + (err.message || err)
        ));
      })
      .save(outputPath);
  });
}

/** 连接超时：防止讯飞侧无响应时挂死请求 */
const WS_CONNECT_TIMEOUT = 10000;
const WS_OVERALL_TIMEOUT = 30000;
const FRAME_SIZE = 1280; // 40ms @ 16kHz/16bit，与发送间隔匹配
const FRAME_INTERVAL = 40;

/**
 * 识别音频文件，返回文本
 * @param {string} audioPath 录音文件路径（任意格式，内部转 PCM）
 */
async function recognizeAudio(audioPath) {
  if (!isConfigured()) {
    throw Object.assign(new Error('语音识别未配置（XF_APP_ID/XF_API_KEY/XF_API_SECRET）'), { status: 503 });
  }

  const pcmPath = await convertToPcm(audioPath);
  const audioBuffer = fs.readFileSync(pcmPath);
  if (!audioBuffer.length) {
    fs.unlinkSync(pcmPath);
    throw new Error('音频内容为空');
  }

  const ws = new WebSocket(getAuthUrl(), { handshakeTimeout: WS_CONNECT_TIMEOUT });

  return new Promise((resolve, reject) => {
    let resultText = '';
    let settled = false;
    const overallTimer = setTimeout(() => {
      finish(new Error('识别超时，请重试'));
    }, WS_OVERALL_TIMEOUT);

    function finish(err, text) {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch (e) { /* 忽略 */ }
      if (err) reject(err);
      else resolve(text);
    }

    ws.on('open', () => {
      sendFrames(ws, audioBuffer);
    });

    ws.on('message', (data) => {
      let res;
      try { res = JSON.parse(data.toString()); } catch (e) { return; }
      if (res.code !== 0) {
        finish(new Error('讯飞ASR错误(' + res.code + ')：' + (res.message || '未知')));
        return;
      }
      // 分词结果累加（status=2 为最终帧，此时 resultText 即完整识别文本）
      if (res.data && res.data.result && Array.isArray(res.data.result.ws)) {
        for (const item of res.data.result.ws) {
          if (item.cw && item.cw[0]) resultText += item.cw[0].w;
        }
      }
      if (res.data && res.data.status === 2) {
        finish(null, resultText.trim());
      }
    });

    ws.on('error', (err) => finish(new Error('识别通道连接失败：' + err.message)));
    ws.on('close', () => {
      // 正常 close 但无 status=2（极端情况）：有文本也尽量返回
      if (!settled) finish(null, resultText.trim());
    });
  });
}

/** 按讯飞帧协议发送音频（首帧 status=0，中间帧 1，末帧 2 且 audio 为空） */
function sendFrames(ws, buffer) {
  let offset = 0;
  function sendNext() {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (offset >= buffer.length) {
      ws.send(JSON.stringify({
        data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' },
      }));
      return;
    }
    const chunk = buffer.slice(offset, offset + FRAME_SIZE);
    offset += FRAME_SIZE;
    const frame = {
      // 讯飞 v2 协议：common 与 business 均为必填且只随首帧下发
      //（缺 common 报 10313，缺 business 报 10303 协议解析失败）
      ...(offset <= FRAME_SIZE ? {
        common: { app_id: XF_APP_ID },
        business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin' },
      } : {}),
      data: {
        status: offset <= FRAME_SIZE ? 0 : 1, // 首帧 0，其余中间帧 1
        format: 'audio/L16;rate=16000',
        encoding: 'raw',
        audio: chunk.toString('base64'),
      },
    };
    ws.send(JSON.stringify(frame));
    setTimeout(sendNext, FRAME_INTERVAL);
  }
  sendNext();
}

module.exports = { recognizeAudio, isConfigured };
