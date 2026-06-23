const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); 
app.use(express.json()); 

const DIFY_APPS = {
  chatbot: {
    apiUrl: 'https://api.dify.ai/v1/chat-messages', 
    apiKey: process.env.DIFY_API_KEY, 
  },
  agent: {
    apiUrl: 'https://api.dify.ai/v1/chat-messages', 
    apiKey: process.env.DIFY_API_KEY, 
  }
};

if (!process.env.DIFY_API_KEY) {
  console.warn('⚠️ 警告: 未检测到环境变量 DIFY_API_KEY！');
}

// 核心接口：完美透传 Dify 的流式 (Streaming) 数据
app.post('/api/chat', async (req, res) => {
  const { message, conversation_id, app_type = 'chatbot', system_prompt } = req.body;
  const config = DIFY_APPS[app_type] || DIFY_APPS.chatbot;

  if (!message) return res.status(400).json({ error: '消息内容不能为空' });

  try {
    const difyPayload = {
      inputs: { system_prompt: system_prompt || '' },
      query: message,
      response_mode: 'streaming', // ⬅️ 恢复为 streaming (流式)
      user: 'onto-ai-frontend-user',
      conversation_id: conversation_id || ''
    };

    const llmResponse = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(difyPayload),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error(`[Dify API 报错]:`, errText);
      return res.status(llmResponse.status).json({ error: 'Dify 服务异常', details: errText });
    }

    // 🚨 关键：设置 SSE 响应头，并强制禁用 Railway/Nginx 的网关缓冲！
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); 
    res.flushHeaders(); 

    // 实时透传 Dify 的流式数据块
    const reader = llmResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();

  } catch (error) {
    console.error('[后端代理错误]:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: '服务器内部错误', details: error.message });
    } else {
      res.end();
    }
  }
});

const PORT = process.env.PORT || 3000; 
app.listen(PORT, () => {
  console.log(`✅ Onto.ai 后端代理已成功启动! (Streaming 防缓冲模式) 端口: ${PORT}`);
});
