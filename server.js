'use strict';

/**
 * 简易 WebSocket 中继服务器（Node.js）
 * - 浏览器端连接此服务器发送音频 JSON 帧
 * - TouchDesigner 端用 WebSocket DAT 作为客户端连接此服务器接收数据
 *
 * 运行：
 *   1) 安装依赖：npm i ws
 *   2) 启动：node server.js 9980
 *
 * 可选环境变量：
 *   PORT=9980 node server.js
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || process.argv[2] || 9980);

/**
 * 创建 HTTP 服务器（仅为了升级握手，不提供静态文件）
 */
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('WebSocket relay is running. Connect via ws://<host>:' + PORT + '\n');
});

/**
 * 创建 WS 服务器
 */
const wss = new WebSocket.Server({ server: httpServer });

/** @type {Set<WebSocket>} */
const clients = new Set();

wss.on('connection', (socket, req) => {
  clients.add(socket);
  console.log('[WS] client connected:', req.socket.remoteAddress);

  socket.on('message', (data) => {
    // 简单广播：把任意消息转发给其他客户端（包括 TD）
    for (const client of clients) {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
    console.log('[WS] client disconnected');
  });

  socket.on('error', (err) => {
    console.warn('[WS] error:', err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log('[WS] relay listening on ws://0.0.0.0:' + PORT);
});


