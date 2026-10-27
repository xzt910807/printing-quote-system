/**
 * LLM 统一调用（OpenAI 兼容 chat/completions）
 * 用途：自然语言解析等文本智能能力统一走这里，后续新增 AI 文本功能直接复用。
 * 通道优先级：
 *   1) Agnes AI（AGNES_API_KEY；OpenAI 兼容接口，模型默认 agnes-3.0-flash。
 *      本项目经自建 new-api 网关转发（AGNES_BASE_URL，与 AI 生图同网关），
 *      网关需有该文本模型渠道且令牌允许；BASE 留空则直连官方 apihub.agnes-ai.com/v1）
 *   2) DeepSeek 回退（DEEPSEEK_API_KEY，历史部署兼容；两者都配了则 Agnes 优先）
 * 都未配置时抛错，由调用方决定降级策略（nl 规则解析兜底，不阻塞主流程）。
 */

const PROVIDERS = [
  {
    name: 'agnes',
    apiKey: () => process.env.AGNES_API_KEY,
    baseUrl: () => (process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1').replace(/\/+$/, ''),
    model: () => process.env.AGNES_TEXT_MODEL || 'agnes-3.0-flash',
  },
  {
    name: 'deepseek',
    apiKey: () => process.env.DEEPSEEK_API_KEY,
    baseUrl: () => 'https://api.deepseek.com/v1',
    model: () => 'deepseek-chat',
  },
];

function resolveProvider() {
  for (const p of PROVIDERS) {
    const apiKey = p.apiKey();
    if (apiKey) return { name: p.name, apiKey, baseUrl: p.baseUrl(), model: p.model() };
  }
  return null;
}

function llmConfigured() {
  return !!resolveProvider();
}

/**
 * 对话补全：messages 为 OpenAI 格式（[{ role, content }]），返回 assistant 文本。
 * opts: { temperature, maxTokens, timeoutMs }
 */
async function chat(messages, opts = {}) {
  const p = resolveProvider();
  if (!p) throw new Error('LLM 未配置（AGNES_API_KEY 或 DEEPSEEK_API_KEY）');

  const body = { model: p.model, messages };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;

  let resp;
  try {
    resp = await fetch(p.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs || 30000),
    });
  } catch (e) {
    throw new Error('LLM(' + p.name + ') 请求失败：' + e.message);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error('LLM(' + p.name + ') HTTP ' + resp.status + (text ? '：' + text.slice(0, 200) : ''));
  }
  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('LLM(' + p.name + ') 未返回内容');
  return content;
}

module.exports = { chat, llmConfigured };
