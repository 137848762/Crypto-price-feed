const http = require('http');
const WebSocket = require('ws');
const express = require('express');

// 创建 Express 应用
const app = express();
const server = http.createServer(app);

// 创建本地 WebSocket 服务器（给前端用）
const localWss = new WebSocket.Server({ server, path: '/ws' });

// 静态文件服务
app.use(express.static('public'));

// 存储feed ID到symbol的映射 - 只保留BTC/USD
let feedIdToSymbol = new Map([
    ['0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', 'BTC/USD']
]);

// 连接到 Pyth Hermes WebSocket 服务
function connectToPythWebSocket() {
    // Pyth Hermes WebSocket 地址
    const hermesWsUrl = 'wss://hermes.pyth.network/ws';
    
    // 创建WebSocket连接
    const pythWs = new WebSocket(hermesWsUrl);
    let retryCount = 0;
    const maxRetries = 5;

    // 处理连接打开事件
    pythWs.onopen = () => {
        console.log(`✅ 成功连接到 Pyth Hermes WebSocket: ${hermesWsUrl}`);
        retryCount = 0; // 重置重试计数
        
        // 发送连接状态给所有客户端
        const statusMsg = JSON.stringify({
            type: 'status',
            message: 'Connected to Pyth Hermes WebSocket',
            connected: true
        });
        
        localWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(statusMsg);
            }
        });
        
        // 订阅feed IDs - 已添加正确的price-id
        const subscribeMsg = JSON.stringify({
            "type": "subscribe",
            "ids": Array.from(feedIdToSymbol.keys())
        });
        
        console.log(`📤 发送订阅请求: ${subscribeMsg}`);
        pythWs.send(subscribeMsg);
    };
    
    // 处理接收到的消息
    pythWs.onmessage = (event) => {
        try {
            console.log('📥 收到 Pyth Hermes 消息');
            
            // 尝试解析消息
            const data = JSON.parse(event.data);
            console.log('🔍 解析后的数据:', data);
            
            // 处理不同类型的消息
            if (data.type === 'price_update') {
                handlePriceUpdate(data);
            } else if (data.type === 'subscribe_response') {
                handleSubscribeResponse(data);
            } else if (data.type === 'error' || data.status === 'error') {
                handlePythError(data);
            } else if (data.type === 'response') {
                if (data.status === 'success') {
                    console.log('✅ Pyth 请求成功响应');
                } else {
                    console.error(`❌ Pyth 响应错误: ${data.error}`);
                    
                    // 发送错误状态给所有客户端
                    const errorMsg = JSON.stringify({
                        type: 'status',
                        message: `Pyth API Error: ${data.error}`,
                        connected: true // 保持连接状态，但显示错误
                    });
                    
                    localWss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(errorMsg);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('❌ 解析消息失败:', error.message);
        }
    };
    
    // 处理WebSocket错误
    pythWs.onerror = (error) => {
        console.error('❌ Pyth Hermes WebSocket 错误:', error.message);
        
        // 发送错误状态给所有客户端
        const errorMsg = JSON.stringify({
            type: 'status',
            message: `WebSocket error: ${error.message}`,
            connected: false
        });
        
        localWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(errorMsg);
            }
        });
    };
    
    // 处理WebSocket连接关闭
    pythWs.onclose = (event) => {
        let closeMessage = '⚠️ Pyth Hermes WebSocket 连接已关闭';
        if (event.code === 1000) {
            closeMessage += ' (正常关闭)';
        } else if (event.code === 1006) {
            closeMessage += ' (连接异常断开)';
        } else {
            closeMessage += ` (错误代码: ${event.code})`;
        }
        
        console.log(closeMessage);
        
        // 发送断开连接状态给所有客户端
        const disconnectMsg = JSON.stringify({
            type: 'status',
            message: 'Disconnected from Pyth Hermes WebSocket',
            connected: false
        });
        
        localWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(disconnectMsg);
            }
        });
        
        // 实现指数退避重连策略
        if (retryCount < maxRetries) {
            retryCount++;
            const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // 最大延迟30秒
            console.log(`🔄 尝试第 ${retryCount}/${maxRetries} 次重连，${delay}毫秒后...`);
            
            setTimeout(() => {
                connectToPythWebSocket();
            }, delay);
        } else {
            console.error('❌ 达到最大重连次数，停止尝试重连。');
        }
    };
    
    return pythWs;
}

// 处理价格更新消息
function handlePriceUpdate(data) {
    try {
        console.log('📊 收到价格更新数据');
        
        // 适配Pyth WebSocket实际的数据格式
        if (data.type === 'price_update' && data.price_feed) {
            const priceFeed = data.price_feed;
            
            // 从feed ID获取symbol - 处理有'0x'前缀和没有'0x'前缀的情况
            const feedId = priceFeed.id;
            let symbol = feedIdToSymbol.get(feedId) || 'Unknown';
            
            // 如果没有找到，尝试添加'0x'前缀再查找
            if (symbol === 'Unknown' && !feedId.startsWith('0x')) {
                const feedIdWithPrefix = '0x' + feedId;
                symbol = feedIdToSymbol.get(feedIdWithPrefix) || 'Unknown';
            }
            
            // 计算实际价格和置信区间
            if (priceFeed.price && typeof priceFeed.price.expo === 'number') {
                const exponent = priceFeed.price.expo;
                const priceValue = parseInt(priceFeed.price.price);
                const confidenceValue = parseInt(priceFeed.price.conf);
                
                // 应用指数计算实际价格
                const price = priceValue / Math.pow(10, Math.abs(exponent));
                const confidence = confidenceValue / Math.pow(10, Math.abs(exponent));
                
                // 格式化输出
                const formattedPrice = price.toFixed(2);
                const formattedConfidence = confidence.toFixed(2);
                
                console.log(`📊 价格更新: ${symbol} = $${formattedPrice} ± $${formattedConfidence}`);

                // 向前端发送价格更新
                const message = JSON.stringify({
                    type: 'price_update',
                    feedId: feedId,
                    price: formattedPrice,
                    confidence: formattedConfidence,
                    symbol: symbol
                });

                // 发送给所有连接的客户端
                sendToAllClients(message);
            } else {
                console.warn('⚠️ 价格数据格式不符合预期:', data);
            }
        } else {
            console.warn('⚠️ 价格数据格式不符合预期:', data);
        }
    } catch (error) {
        console.error('❌ 处理价格更新失败:', error.message);
    }
}

// 处理订阅响应
function handleSubscribeResponse(data) {
    if (data.success) {
        console.log('✅ 成功订阅价格更新');
        
        // 发送成功状态给所有客户端
        const successMsg = JSON.stringify({
            type: 'status',
            message: 'Successfully subscribed to price updates',
            connected: true
        });
        
        localWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(successMsg);
            }
        });
    } else {
        console.error('❌ 订阅失败:', data.reason || 'Unknown reason');
        
        // 发送失败状态给所有客户端
        const errorMsg = JSON.stringify({
            type: 'status',
            message: `Subscription failed: ${data.reason || 'Unknown reason'}`,
            connected: true // 保持连接状态，但显示错误
        });
        
        localWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(errorMsg);
            }
        });
    }
}

// 处理 Pyth 错误消息
function handlePythError(data) {
    const errorMessage = data.message || data.error || 'Unknown error';
    console.error('❌ Pyth 错误:', errorMessage);
    
    // 发送错误状态给所有客户端
    const errorMsg = JSON.stringify({
        type: 'status',
        message: `Pyth Error: ${errorMessage}`,
        connected: true // 保持连接状态，但显示错误
    });
    
    localWss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(errorMsg);
        }
    });
}

// 发送消息给所有连接的客户端
function sendToAllClients(message) {
    localWss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            console.log('📤 已转发给前端');
        }
    });
}

// 监听本地客户端连接
localWss.on('connection', (ws) => {
    console.log('🟢 前端已连接到本地 WebSocket');
    ws.send(JSON.stringify({ type: 'status', message: 'Connected to server' }));
    
    // 发送状态更新
    ws.send(JSON.stringify({
        type: 'status',
        message: 'Connecting to Pyth Network...',
        connected: true
    }));
});

// 启动 HTTP 服务器
const PORT = process.env.PORT || 8081;
server.listen(PORT, () => {
    console.log(`🟢 本地服务器已启动: http://localhost:${PORT}`);
    console.log(`🟢 本地 WebSocket 可用: ws://localhost:${PORT}/ws`);
    
    // 启动后连接到 Pyth Hermes WebSocket
    console.log('🔄 开始连接到 Pyth Hermes WebSocket...');
    connectToPythWebSocket();
});