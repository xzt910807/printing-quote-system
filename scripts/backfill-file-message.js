/**
 * 一次性回填脚本：把历史协同文件补成会话消息
 * 背景：026 的文件只写 file_transfer, 聊天页靠底部「会话文件」面板展示, 对方不进这个会话就不知道有新文件。
 *       现在文件是消息流里的一条（inquiry_message.msg_type='file' + file_id）, 存量文件不补就会在会话里隐身。
 * 用法：
 *   node scripts/backfill-file-message.js            # 试运行（打印将要插入的消息, 不写库）
 *   node scripts/backfill-file-message.js --apply    # 实际写入
 *
 * 口径：
 *   - 只处理 ref_type='inquiry'（order/issue 的文件不进 IM, 各有自己的附件列表）
 *   - 已回填过的（存在 msg_type='file' 且 file_id 相同的消息）自动跳过, 脚本可重复跑
 *   - is_read 直接置 1：这些文件本来就在面板里露过面, 不该再算未读把人吓一跳
 *   - created_at 用文件的上传时间, 时间分隔线显示的是真实发送时刻
 *   - 顺手清洗一步：早期版本的图片消息把微信随机文件名写进了 content（[图片] NJA13TC3…jpg）,
 *     会话列表里就是一串乱码, 一律压成「[图片]」（与新的写入口径对齐, 幂等）
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

function isImage(mime, name) {
  return /^image\//.test(String(mime || '')) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(String(name || ''));
}

// 文案口径与 src/services/inquiryChatService.js 的 fileLabel() 一致：图片不拼文件名
function fileLabel(image, fileName) {
  if (image) return '[图片]';
  const name = String(fileName || '未命名').trim();
  return `[文件] ${name.length > 40 ? name.slice(0, 40) + '…' : name}`;
}

async function main() {
  const doApply = process.argv.includes('--apply');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    console.log(`目标库：${process.env.DB_NAME}@${process.env.DB_HOST}`);
    console.log(`模式：${doApply ? '★ 执行回填' : '试运行（不写库）'}\n`);

    // 会话表缺列说明结构还没同步（表结构变更走 init.sql + schema-sync）
    const [[{ cnt: colCnt }]] = await conn.query(
      `SELECT COUNT(*) cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inquiry_message' AND COLUMN_NAME IN ('msg_type','file_id')`
    );
    if (colCnt < 2) {
      console.error('❌ inquiry_message 缺少 msg_type/file_id 列，先执行：node scripts/schema-sync.js --apply');
      process.exit(1);
    }

    // 第一步：清洗历史图片消息的 content（后面的补录候选查询与此无关, 故先做完）
    const [dirty] = await conn.query(
      "SELECT id, content FROM inquiry_message WHERE msg_type = 'file' AND content LIKE '[图片] %'"
    );
    console.log(`待规整的图片消息：${dirty.length} 条`);
    if (doApply && dirty.length) {
      const [fix] = await conn.query(
        "UPDATE inquiry_message SET content = '[图片]' WHERE msg_type = 'file' AND content LIKE '[图片] %'"
      );
      console.log(`  ✓ 已压成「[图片]」：${fix.affectedRows} 条\n`);
    } else if (dirty.length) {
      dirty.slice(0, 5).forEach((d) => console.log(`  · #${d.id} ${d.content.slice(0, 60)}`));
      console.log('  （试运行不写库）\n');
    } else {
      console.log('');
    }

    const [rows] = await conn.query(
      `SELECT ft.id, ft.ref_id AS inquiry_id, ft.sender_type, ft.sender_id, ft.file_name, ft.mime_type, ft.created_at
       FROM file_transfer ft
       WHERE ft.ref_type = 'inquiry'
         AND NOT EXISTS (SELECT 1 FROM inquiry_message im WHERE im.msg_type = 'file' AND im.file_id = ft.id)
       ORDER BY ft.id`
    );
    if (!rows.length) { console.log('没有待回填的询价文件，结构已对齐'); return; }

    let done = 0, skipped = 0;
    for (const f of rows) {
      const label = fileLabel(isImage(f.mime_type, f.file_name), f.file_name);
      // 会话键是 inquiry×factory：工厂发的对家就是本厂, 客户发的要认准当时聊的是哪家
      let factoryId = 0;
      let senderId = f.sender_id;
      if (f.sender_type === 'factory') {
        // file_transfer 存的是 factory.id, 会话表的工厂发送人是操作员（factory_user.id）, 取该厂一个在职账号
        const [[fu]] = await conn.query(
          'SELECT id FROM factory_user WHERE factory_id = ? AND status = 1 ORDER BY id LIMIT 1', [f.sender_id]
        );
        factoryId = f.sender_id;
        senderId = fu ? fu.id : f.sender_id;
      } else {
        const [[inq]] = await conn.query('SELECT matched_factory_id FROM c_inquiry WHERE id = ?', [f.inquiry_id]);
        if (inq && inq.matched_factory_id) {
          factoryId = Number(inq.matched_factory_id);
        } else {
          // 没定厂时若只推过一家, 那家就是唯一的对家; 推过多家则无法判断, 不猜
          const [ps] = await conn.query(
            'SELECT factory_id FROM factory_inquiry_push WHERE inquiry_id = ?', [f.inquiry_id]
          );
          if (ps.length === 1) factoryId = Number(ps[0].factory_id);
        }
      }
      const [[push]] = await conn.query(
        'SELECT id FROM factory_inquiry_push WHERE inquiry_id = ? AND factory_id = ?', [f.inquiry_id, factoryId]
      );
      if (!factoryId || !push) {
        skipped++;
        console.log(`  ⚠️ 跳过 #${f.id}（询价 ${f.inquiry_id}）：对家工厂${factoryId ? '不是本会话推送对象' : '无法确定'}`);
        continue;
      }
      if (!doApply) {
        done++;
        console.log(`  ✓ 询价 ${f.inquiry_id} × 工厂 ${factoryId} ← ${label}`);
        continue;
      }
      try {
        await conn.query(
          `INSERT INTO inquiry_message (inquiry_id, factory_id, sender_type, sender_id, content, msg_type, file_id, is_read, created_at)
           VALUES (?,?,?,?,?,'file',?,1,?)`,
          [f.inquiry_id, factoryId, f.sender_type, senderId, label, f.id, f.created_at]
        );
        done++;
        console.log(`  ✓ 已补 #${f.id} → 询价 ${f.inquiry_id} × 工厂 ${factoryId}：${label}`);
      } catch (e) {
        skipped++;
        console.warn(`  ✗ #${f.id} 插入失败：${e.message}`);
      }
    }
    console.log(`\n合计：候选 ${rows.length} / 回填 ${done} / 跳过 ${skipped}`);
    if (!doApply) console.log('\n确认无误后执行：node scripts/backfill-file-message.js --apply');
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error('[backfill-file-message] 失败:', e.message); process.exit(1); });
