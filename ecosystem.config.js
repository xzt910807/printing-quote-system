// PM2 进程守护配置（服务器上：pm2 start ecosystem.config.js / pm2 restart printing-quote）
module.exports = {
  apps: [
    {
      name: 'printing-quote',
      script: 'src/app.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      // 服务器时区建议 Asia/Shanghai，日志按天切分可用 pm2-logrotate 模块
      out_file: '/var/log/printing-quote/out.log',
      error_file: '/var/log/printing-quote/error.log',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 6001,
      },
    },
  ],
};
