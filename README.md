使用说明（Node.js WebSocket 中继）

启动中继服务器

1. 安装依赖（首次）：
   npm i
2. 启动（默认 9980）：
   npm run start
   或指定端口：
   PORT=9001 npm run start

服务器启动后监听 `ws://127.0.0.1:<端口>`。

网页端

- 在页面“连接 TouchDesigner”的地址填写 `ws://127.0.0.1:9980`，点击“连接”。
- 播放音乐后会持续发送 `audioFrame` JSON（features + spectrum）。

TouchDesigner 端（没有 WebSocket Server DAT 的版本）

- 放置 `WebSocket DAT`（客户端），`Network Address` 留空或填 `127.0.0.1`，`Network Port` 与服务器一致（如 9980），`Active=On`。
- 在 `Callbacks DAT` 里粘贴 `websocket1_callbacks`（同会话提供的版本），即可将 JSON 解析到 `features_table` 与 `spectrum_table`。
- 如需曲线预览：建 `Constant CHOP` 命名 `features_out` 并接 `Trail CHOP`；建 `DAT to CHOP` 指向 `spectrum_table` 以获得谱曲线。

常见问题

- Windows 防火墙：首次运行 Node.js 服务器时允许访问。
- 端口占用：换个端口并在网页与 TD 同步修改。
- 未收到数据：确认网页“播放”已开始且已“连接”。

TD 网络搭建示意（按步照做即可看到曲线）

1. 放置 `WebSocket DAT`（客户端）并设置：
   - Network Address: `127.0.0.1`
   - Network Port: `9980`
   - Active: `On`
   - Callbacks DAT: 选择 `websocket1_callbacks`（调试版）

2. 新建 `Constant CHOP`，命名 `features_out`（保持 5 通道）。
   - 接一个 `Trail CHOP`（Length: 5–10s）→ 观察 5 条曲线：energy/low/mid/high/peak。

3. 频谱可视化：
   - 回调会自动创建 `spectrum_table`（Table DAT）。
   - 新建 `DAT to CHOP`，命名 `spectrum_out`，`DAT` 指向 `spectrum_table`，勾选 “First Row is Header”。
   - 接 `Trail CHOP` 观察历史曲线；或接 `Shuffle CHOP` 调整为多通道后再用其他 CHOP/TOP 做条形/光谱。

4. 验证收包：
   - 选中 `WebSocket DAT` → “Received Messages” 页签应持续出现 `audioFrame` JSON。
   - Textport 会打印非 `audioFrame` 的消息类型（调试版）。

5. 网页端：
   - 地址填 `ws://127.0.0.1:9980` → 点击“连接”。
   - 选择音频并“播放”（播放中才会持续发送）。



