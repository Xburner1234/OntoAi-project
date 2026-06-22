// server.js - Onto.ai Dify 后端代理服务 (云端部署优化版)
const express = require('express');
const cors = require('cors');

const app = express();

// 允许跨域请求 (云端部署必备)
app.use(cors()); 
app.use(express.json()); 

// ==========================================
// 🔑 Dify 应用配置 (从环境变量读取，保护密钥安全)
// ==========================================
const DIFY_APPS = {
  // 1. 普通对话 (Chatbot)
  chatbot: {
    // 如果您使用的是 Dify 本地部署版，请将此 URL 改为 'http://localhost/v1/chat-messages'
    apiUrl: 'https://api.dify.ai/v1/chat-messages', 
    // ⚠️ 关键：从环境变量读取 API Key，绝不硬编码
    apiKey: process.env.DIFY_API_KEY, 
  },
  // 2. 智能体 (Agent)
  agent: {
    apiUrl: 'https://api.dify.ai/v1/chat-messages', 
    apiKey: process.env.DIFY_API_KEY, 
  }
};

// 检查环境变量是否配置成功 (仅在启动时提示)
if (!process.env.DIFY_API_KEY) {
  console.warn('⚠️ 警告: 未检测到环境变量 DIFY_API_KEY，请确保已在运行环境或云平台中配置！');
}

// ==========================================
// 🚀 核心接口: 对话与 Agent (支持流式 SSE 透传)
// ==========================================
app.post('/api/chat', async (req, res) => {
  const { message, conversation_id, app_type = 'chatbot', system_prompt } = req.body;
  const config = DIFY_APPS[app_type] || DIFY_APPS.chatbot;

  if (!message) {
    return res.status(400).json({ error: '消息内容不能为空' });
  }

  try {
    // 构造 Dify API 要求的请求体
    const difyPayload = {
      // 将前端传来的自定义 Agent 描述作为 inputs 变量传给 Dify
      inputs: { system_prompt: system_prompt || '' },
      query: message,
      response_mode: 'streaming', // 强制开启流式输出
      user: 'onto-ai-frontend-user', 
      conversation_id: conversation_id || '' 
    };

    // 请求 Dify API
    const llmResponse = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(difyPayload),
    });

    // 处理 Dify 返回的错误
    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error(`[Dify ${app_type} API 报错]:`, errText);
      return res.status(llmResponse.status).json({ error: 'Dify 服务异常', details: errText });
    }

    // 设置 SSE (Server-Sent Events) 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // ⬅️ 新增：强制立即发送响应头，防止 Railway 网关缓冲流式数据

    // 将 Dify 的流式数据块实时透传给前端
    const reader = llmResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end(); // 流结束，关闭响应

  } catch (error) {
    console.error('[后端代理错误]:', error);
    res.status(500).json({ error: '服务器内部错误', details: error.message });
  }
});

// ==========================================
// 🏁 启动服务器 (使用环境变量 PORT 以适配云端平台)
// ==========================================
// Render 等云平台会动态分配 PORT，本地运行时默认使用 3000
const PORT = process.env.PORT || 3000; 

app.listen(PORT, () => {
  console.log('==================================================');
  console.log(`✅ Onto.ai 后端代理已成功启动!`);
  console.log(`🚀 服务运行在端口: ${PORT}`);
  console.log(`💬 对话/Agent 接口: POST /api/chat`);
  console.log('==================================================');
});
