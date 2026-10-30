# 管理端 / 工厂端菜单与权限对照

后台是**同一个 SPA**（`admin/index.html` + `admin/js/app.js`），登录后按身份切视角：
`api.getLoginType() === 'factory'` 时 `state.isFactoryMode = true`，菜单、页面标题、表格列、按钮都跟着变。
本文说明「谁能看见哪个菜单、点进去打哪个接口、接口要什么权限点」，以及为什么一个菜单项要配两个权限点。

## 1. 决定菜单可见性的三样东西

| 字段 | 含义 |
|---|---|
| `mode` | `both`=两端都有；`admin`=仅管理端；`factory`=仅工厂端 |
| `perm` | **工厂端**视角使用的权限点 |
| `adminPerm` | **管理端**视角使用的权限点（缺省时回落到 `perm`） |
| `hasPerm(perm)` | 判定当前身份是否具备该权限点，决定菜单渲染与 `goto()` 放行 |

判定顺序（`visibleMenu` / `goto()` 共用同一函数 `itemPerm`）：

```js
itemPerm(item) = state.isFactoryMode ? item.perm : (item.adminPerm || item.perm)
```

`hasPerm` 拿不到权限清单时**一律按「不给看」兜底**（fail-closed）：

- 工厂端：优先 `factoryAuth.permissions`（登录时后端下发）；老会话没有这个数组时按 `role === 'owner'` 兜底，
  连 `role` 都取不到则暂放行——这是工厂端遗留的宽松点（新登录必带 `permissions`，实际走不到），
  接口层仍有 `requireFactory` + 数据归属兜住，与管理端那条不是一个量级。
- 管理端：优先 `admin-me` 返回的 `perms`；缺失时按角色缺口表 `ADMIN_ROLE_DENY = { super: [], admin: ['account:manage'] }` 判定，
  **未知角色直接 false**。这里如果放宽，只会摆出一堆点进去就 403 的菜单——后端 `requirePermission` 只认 `ROLE_PERMISSIONS`。

## 2. 为什么一个菜单项要配两个权限点

同一菜单项在两端打的是**不同接口**：管理端读全平台数据，工厂端只读本厂数据，两套接口的权限点自然不同源。
只配一个 `perm` 会出现两种坏结果——菜单点得进去但接口 403，或者后端要 A 权限、菜单按 B 权限显示。

本轮实际踩到并修好的两个：

| 菜单 | 修前 | 修后 |
|---|---|---|
| C端询价 | 菜单查 `inquiry:view`（工厂侧权限点），管理端接口 `/api/c/inquiry/list` 要 `c_inquiry:view`，两者不同源 | `perm: 'inquiry:view'` + `adminPerm: 'c_inquiry:view'` |
| 工单管理 | 菜单查 `inquiry:view`，管理端接口要 `issue:view` | `perm: 'inquiry:view'` + `adminPerm: 'issue:view'` |

## 3. 菜单对照总表（按侧栏分组）

分组顺序：`概览 → 业务 → 协同 → 管理 → 系统`（「协同」为 stage18 新增，买卖双方沟通与交付物自成一段）。

| 分组 | key | 管理端标题 | 工厂端标题 | mode | 工厂权限点 | 管理权限点 |
|---|---|---|---|---|---|---|
| 概览 | `dashboard` | 数据概览 | 我的数据 | both | `dashboard:view` | `dashboard:view` |
| 业务 | `calculator` | 报价计算器 | 同 | both | `calculator:use` | `calculator:use` |
| 业务 | `quotes` | 报价单 | 我的报价单 | both | `quote:view` | `quote:view` |
| 业务 | `inquiries` | C端询价 | 我的询价 | both | `inquiry:view` | `c_inquiry:view` |
| 业务 | `orders` | 订单管理 | 我的订单 | both | `order:view` | `order:view` |
| 业务 | `issues` | 工单管理 | 售后工单 | both | `inquiry:view` | `issue:view` |
| 业务 | `finance` | — | 财务对账（建设中） | factory | `finance:view` | — |
| 协同 | `chats` | 询价会话 | 客户会话 | both | `inquiry:view` | `chat:view` |
| 协同 | `messages` | 站内消息 | — | admin | — | `message:view` |
| 协同 | `designs` | 设计稿台账 | 设计稿待办 | both | `inquiry:view` | `design:view` |
| 管理 | `pricing` | — | 价格设置 | factory | `price:edit` | — |
| 管理 | `staff` | — | 员工管理 | factory | `staff:manage` | — |
| 管理 | `shipping` | 运费模板 | — | admin | — | `shipping:manage` |
| 管理 | `factories` | 工厂管理 | — | admin | — | `factory:manage` |
| 管理 | `customers` | 客户管理 | 同 | both | `customer:manage` | `customer:manage` |
| 管理 | `catalog` | 目录数据 | — | admin | — | `catalog:view` |
| 管理 | `news` | 资讯管理 | — | admin | — | `news:manage` |
| 管理 | `community` | 社区审核 | — | admin | — | `community:view`（读）/ `community:manage`（写） |
| 系统 | `arbitration` | 仲裁中心 | — | admin | — | `order:view` |
| 系统 | `accounts` | 账户管理 | — | admin | — | `account:manage`（super 专属） |
| 系统 | `sessions` | 在线设备 | — | admin | — | `session:view` |
| 系统 | `fee-ledger` | 服务费台账 | — | admin | — | `finance:view` |

## 4. 协同三项的接口与鉴权

| 菜单 | 管理端接口（权限点） | 工厂端接口（权限点） |
|---|---|---|
| 询价会话 | `GET /api/admin/chat/threads`、`GET /api/admin/chat/thread/:inquiryId?factoryId=`（`chat:view`） | `GET /api/messages/threads`、`GET /api/messages/thread/:inquiryId`、`POST /api/messages/send`、`POST /api/factory/file/upload`（身份鉴权，见下） |
| 站内消息 | `GET /api/admin/messages`（`message:view`） | 无（工厂侧留痕写在 `c_message` 的 `user_id=0`，管理端可筛 `target=system` 看） |
| 设计稿 | `GET /api/admin/designs`（`design:view`） | `GET /api/factory/designs`（`inquiry:view`） |
| 社区内容 | `GET /api/admin/community/posts`、`/comments`、`/reports`、`/categories`（`community:view`） | 无（社区对工厂开的是小程序端 `/api/c/community`，身份由 `resolveIdentity` 从 `X-Factory-*` 推导；后台审核队列不给工厂看，避免自己审自己） |

三条口径必须记住：

- **管理端只看不动**：会话详情走 `getThreadAdmin`（纯 SELECT），不能复用 `listThread`——后者会把对方消息置为已读，
  运营查一次纠纷就吃掉客户/工厂的红点。工厂端/客户端本人读会话才置已读，那是正当行为。
- **站内消息只读**：写已读属于收件人行为，平台代点会污染用户未读状态。
- **工厂端会话不挂 `requirePermission`**：`/api/messages/*` 是买卖双方共用语口，靠身份与数据归属收口（见第 6 节），
  菜单上的 `inquiry:view` 只负责「要不要给这个员工看这个入口」。

## 5. 角色 → 能看到什么

权限点定义在 `src/config/permissions.js`（角色→权限为代码常量，登录时随令牌下发）。

**管理侧**（`admin_user.role`）：

| 角色 | 权限范围 | 菜单效果 |
|---|---|---|
| `super` | 全部权限点 | 含「账户管理」 |
| `admin` | 全量去掉 `account:manage` | 看不到「账户管理」，其余全可见（含仲裁、工单推进） |
| `viewer` | 仅 `dashboard:view` | 只剩「数据概览」；直接请求协同/工单/仲裁接口一律 403 |

**工厂侧**（`factory_user.role`，基准集 `FACTORY_ALL`）：

| 角色 | 与基准集的差 | 工厂视角菜单效果 |
|---|---|---|
| `owner` | 全量 | 我的数据/计算器/报价单/询价/订单/售后工单/客户/财务/价格/员工/会话/设计稿 |
| `manager` | 去掉 `staff:manage` | 看不到「员工管理」 |
| `sales` | 无财务、无改价、无员工 | 看不到「财务对账」「价格设置」「员工管理」 |
| `finance` | 仅 `dashboard/order/finance` | 只剩「我的数据」「我的订单」 |
| `designer` | 仅 `dashboard:view/order:view` | 只剩「我的数据」「我的订单」；请求 `/api/factory/designs` 会 403（该接口要 `inquiry:view`） |

## 6. 工厂端为什么翻不到别家的数据

工厂端菜单放开「客户会话 / 设计稿待办」不等于给了越权能力，隔离在接口层做：

- `X-Factory-Id` + `X-Factory-Token` 经 `requireFactory` 校验后，`factoryId` 由**令牌推导**，前端即使传别人的 id 也不采信；
- 会话与文件访问走 `assertFactoryAccess`，核对 `factory_inquiry_push` 是否存在「该询价推给该厂」的记录，没有就 403；
- 设计稿待办的 WHERE 首项恒为 `ip.factory_id = ?`，`uk_inquiry_factory` 保证一询价对一厂只有一行；
- 下发字段按视角裁剪：工厂端不含客户昵称与手机号，`keyword` 也只搜询价单号与需求描述，搜不到客户姓名。

## 7. 按钮级权限（写操作与后端同口径）

菜单可见 ≠ 按钮可点。写操作按钮单独判定，与后端权限点一一对应：

| 按钮 | 前端判定 | 后端权限点 |
|---|---|---|
| 工单「接手 / 推进 / 关闭」 | `canIssueManage` = 非工厂视角 && `hasPerm('issue:manage')` | `PUT /api/admin/issue/:id` → `issue:manage` |
| 仲裁「裁定退款 / 放款」 | `canArbitrate` = 非工厂视角 && `hasPerm('order:manage')` | `POST /api/admin/order/:id/arbitrate` → `order:manage` |
| 会话「发送 / 发文件」 | 仅工厂视角渲染（管理端会话面板只读） | `/api/messages/send`、`/api/factory/file/upload` 走工厂身份 |
| 社区「通过 / 驳回 / 下架 / 置顶 / 加精 / 举报处置 / 版块启停」 | `canCommunityManage` = 非工厂视角 && `hasPerm('community:manage')` | `/api/admin/community/post/:id/audit`、`/comment/:id/audit`、`/report/:id/handle`、`/category*` → `community:manage` |

## 8. 新增一个两端菜单项要改的四处

1. `src/config/permissions.js`：需要新权限点就先加进 `PERMISSIONS`，并确认它该进哪几个角色（`super/admin` 是全量派生，新点自动授予）。
2. 后端路由：管理端 router 挂 `requirePermission('xxx:view')`，工厂端接口按第 6 节收口数据范围。
3. `admin/js/app.js` 的 `NAV_MENU`：填 `mode` / `perm` /（两端不同源时）`adminPerm` / 独立 `svg` 图标 / 工厂端 `factoryTitle`，并补 `pageTitle` 两个视角的文案。
4. 写按钮：加 computed 与后端权限点对齐，别用「菜单可见」当「可操作」。

改完 `admin/js/app.js` 或 `admin/css/style.css` 必须升 `index.html` 里的 `?v=` 版本号，否则浏览器用旧缓存。

## 9. stage18 修掉的菜单可见性缺陷（留档）

| 缺陷 | 后果 | 修法 |
|---|---|---|
| `POST /api/admin/order/:id/arbitrate` 只挂 `requireAdmin` | 推动担保资金退款/放款的资金写接口，只读角色也能执行 | 补 `requirePermission('order:manage')` |
| `/api/admin/issue` 三个接口只挂 `requireAdmin` | 工单读写无权限区分 | 新增 `issue:view` / `issue:manage` 并挂上 |
| 「C端询价」菜单权限点与接口权限点不同源 | 菜单显示与 403 打架 | 引入 `adminPerm` 双权限点机制 |
| `hasPerm` 在 perms 缺失时 `return perm !== 'account:manage'` | 未知身份 = 全部放行 | 改为按角色缺口表兜底，未知角色 false |
