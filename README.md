# Pyth Price Feeds 演示应用

这是一个演示应用程序，用于连接和显示来自 Pyth Network 的加密货币价格数据。

## 当前实现状态

已成功实现与 Pyth Network 的真实连接：

- 使用 WebSocket 连接到 Pyth Hermes WebSocket 服务获取实时价格数据
- 简化为仅保留 BTC/USD 的价格数据源
- 支持从 Pyth Network 接收真实的 price_update 消息
- 正确处理 Pyth 的数据格式并转换为可读的价格信息
- 本地 WebSocket 服务器将真实价格更新推送给前端

## 如何运行

1. 安装依赖：
```bash
npm install
```

2. 启动服务器：
```bash
node server.js
```

3. 打开浏览器，访问 http://localhost:8081/

## 项目结构

- `server.js` - 服务器端代码，包含：
  - 连接到 Pyth Hermes WebSocket 服务的逻辑
  - 处理 Pyth price_update 消息的数据转换
  - 本地 WebSocket 服务器实现，向前端推送价格更新
  - 简化的 feedIdToSymbol 映射（仅包含 BTC/USD）
- `public/index.html` - 前端页面，包含：
  - WebSocket 客户端连接逻辑
  - 实时价格数据展示界面
  - 连接状态指示器

## 注意事项

- 项目当前使用有效的 BTC/USD price-id 连接到 Pyth Network
- 已适配 Pyth WebSocket 的实际数据格式（处理expo字段替代exponent，解析price和conf字段）
- 支持处理带'0x'前缀和不带前缀的feed ID
- 本地 WebSocket 服务器会将 Pyth 的价格数据转发给前端展示

## 未来改进方向

1. 根据需求添加更多加密货币对的数据源
2. 实现数据缓存机制，提高响应速度
3. 添加历史价格图表和分析功能
4. 增强错误处理和重试机制
5. 优化前端展示和用户体验