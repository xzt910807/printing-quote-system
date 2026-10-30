/**
 * RBAC 权限体系（需求文档 4.20 / 附录 11.1）
 * 权限点命名：模块:动作；角色→权限映射为代码常量，登录时随令牌下发，前端按此渲染菜单/按钮
 */
const { fail } = require('../utils/helpers');

// 全部权限点
const PERMISSIONS = [
  'dashboard:view',   // 数据概览
  'calculator:use',   // 报价计算器
  'price:view',       // 查看价格
  'price:edit',       // 编辑价格
  'inquiry:view',     // 查看询价
  'inquiry:accept',   // 接单/拒绝
  'order:view',       // 查看订单
  'order:manage',     // 管理订单（改价/取消等）
  'order:ship',       // 发货
  'finance:view',     // 财务对账
  'finance:withdraw', // 提现
  'staff:view',       // 查看员工
  'staff:manage',     // 管理员工（owner 专属）
  'factory:view',     // 工厂列表
  'factory:manage',   // 工厂管理（审核/能力/开户）
  'catalog:view',     // 目录数据
  'catalog:edit',     // 编辑目录
  'c_inquiry:view',   // 全部 C 端询价
  'account:manage',   // 管理员账户管理（super 专属）
  'shipping:manage',  // 运费模板
  'customer:manage',  // 客户管理
  'quote:view',       // 全部报价单
  'session:view',     // 查看在线设备/会话（F-148）
  'session:revoke',   // 强制下线（F-150）
  'news:manage',      // 行业资讯管理与选稿（028/031，仅平台侧）
  'issue:view',       // 售后工单查看（仅平台侧；工厂侧看自家工单走 inquiry:view）
  'issue:manage',     // 售后工单介入（推进状态/写处理备注，仅平台侧）
  'chat:view',        // 询价会话（买卖双方 IM）只读查看，仅平台侧介入纠纷用
  'message:view',     // C 端站内消息（c_message）只读查看，仅平台侧
  'design:view',      // 设计稿台账（询价单 design_* 汇总）只读查看，仅平台侧
  // Batch D4 社区：只能平台侧审核，不写进 FACTORY_ALL——工厂在小程序里能发帖，
  // 但在后台看不到审核队列，更不能自己审自己（工厂令牌打社区后台接口一律 401）
  'community:view',   // 社区帖子/评论/举报只读查看
  'community:manage', // 社区审核/加精/置顶/删除/举报处置
];

// 工厂侧全权限（owner 基准，manager 去掉员工管理）
// 026：追加 customer:manage（本厂客户管理）与 quote:view（本厂报价单），接口侧按工厂隔离数据
const FACTORY_ALL = [
  'dashboard:view', 'calculator:use',
  'price:view', 'price:edit',
  'inquiry:view', 'inquiry:accept',
  'order:view', 'order:manage', 'order:ship',
  'finance:view', 'finance:withdraw',
  'staff:view', 'staff:manage',
  'customer:manage', 'quote:view',
];

// 角色 → 权限映射
const ROLE_PERMISSIONS = {
  super: PERMISSIONS.slice(),
  admin: PERMISSIONS.filter((p) => p !== 'account:manage'),
  owner: FACTORY_ALL.slice(),
  manager: FACTORY_ALL.filter((p) => p !== 'staff:manage'),
  // 业务员：询价/报价/接单/看订单/发货，不看财务、不管员工、不改价；026：加本厂客户与本厂报价单
  sales: ['dashboard:view', 'calculator:use', 'price:view', 'inquiry:view', 'inquiry:accept', 'order:view', 'order:ship', 'customer:manage', 'quote:view'],
  // 财务：看订单、对账、提现
  finance: ['dashboard:view', 'order:view', 'finance:view', 'finance:withdraw'],
  // 设计：看订单、传文件（文件上传随订单接口，无需独立权限点）
  designer: ['dashboard:view', 'order:view'],
  // 只读
  viewer: ['dashboard:view'],
  // C 端用户不走权限点（数据归属即权限），置空数组便于统一判断
  customer: [],
};

function permsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * 权限校验中间件：挂在具体路由上（requireAdmin / requireFactory 之后）
 * 同时兼容管理端（req.admin.role）与工厂端（req.factoryUser.role）
 * 使用：router.post('/xxx', requireFactory, requirePermission('price:edit'), handler)
 */
function requirePermission(perm) {
  return (req, res, next) => {
    const actor = req.admin || req.factoryUser;
    if (!actor) return res.status(401).json(fail('未登录', 401));
    const perms = permsForRole(actor.role);
    if (!perms.includes(perm)) {
      return res.status(403).json(fail('无权执行该操作（缺少权限：' + perm + '）', 403));
    }
    next();
  };
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, permsForRole, requirePermission };
