import { building } from '$app/environment';
import { env, type Server } from 'bun';

// 定义 WebSocket 数据类型
interface WebSocketData {
  requestUrl?: string;
  finalServerWs?: WebSocket;
  messageQueue?: Array<string | Buffer>;
  connectionFailed?: boolean;
  connectionTimeout?: NodeJS.Timeout;
}

// 全局变量，用于跟踪服务器实例
let bunServer: Server<WebSocketData> | null = null;

// Don't run the WebSocket server during build
if (!building) {
  startWebSocketServer();
}

async function startWebSocketServer() {
  // 如果已有服务器实例，先关闭它
  if (bunServer) {
    console.log('关闭现有的 WebSocket 服务器...');
    bunServer.stop(true);
    bunServer = null;
  }

  try {
    const defaultWsUrl = 'wss://api.stepfun.com/v1/realtime';
    const defaultModel = 'step-audio-2';
    const defaultApiKey = env.API_KEY || '';

    // 创建 Bun WebSocket 服务器
    bunServer = Bun.serve({
      port: 8080,
      fetch(req, server) {
        // 处理 WebSocket 升级请求
        const success = server.upgrade(req, {
          // 将请求 URL 传递给 WebSocket 数据
          data: { requestUrl: req.url } as WebSocketData
        });

        if (success) {
          return;
        }
        return new Response('Upgrade failed', { status: 500 });
      },
      websocket: {
        open(ws: any) {
          console.log('Client connected');

          // 初始化 ws.data 对象
          ws.data = ws.data || {};

          // 获取请求 URL，如果不存在则使用默认值
          const requestUrl = ws.data.requestUrl || '';

          // 安全地解析 URL
          let url;
          let clientApiKey = null;
          let clientModel = null;
          let wsUrl = null;
          let apiKeyType = null;

          try {
            if (requestUrl) {
              url = new URL(requestUrl);
              clientApiKey = url.searchParams.get('apiKey');
              clientModel = url.searchParams.get('model');
              wsUrl = url.searchParams.get('wsUrl');
              apiKeyType = url.searchParams.get('apiKeyType');
            }
          } catch (e) {
            console.error('Error parsing URL:', e);
            // 如果 URL 解析失败，继续使用默认值
          }

          if (wsUrl) {
            try {
              wsUrl = decodeURIComponent(wsUrl); // 解码 URL 编码
              new URL(wsUrl); // 确保 URL 是有效的
              console.log(`Using custom ws URL: ${wsUrl}`);
            } catch (e) {
              console.error(`Invalid custom server URL: ${wsUrl}`, e);
              wsUrl = null; // 如果 URL 无效，使用默认值
            }
          }

          const apiKey = clientApiKey || defaultApiKey;

          const model = clientModel || defaultModel;

          console.log(`Using model: ${model}`);

          // 构建最终的服务器 URL
          let finalWsUrl;
          if (wsUrl) {
            // 如果提供了自定义服务器 URL，使用它
            finalWsUrl = wsUrl;
            // 如果自定义 URL 没有包含模型参数，添加它
            if (!finalWsUrl.includes('model=')) {
              finalWsUrl += (finalWsUrl.includes('?') ? '&' : '?') + `model=${model}`;
            }
          } else {
            // 否则使用默认服务器 URL 并添加模型参数
            finalWsUrl = `${defaultWsUrl}?model=${model}`;
          }

          console.log(`Connecting to: ${finalWsUrl}`);

          // 创建消息队列，存储在连接建立前收到的消息
          const messageQueue: Array<string | Buffer> = [];
          let connectionFailed = false; // 标记连接是否已失败

          // 创建到最终服务器的 WebSocket 连接
          const finalServerWs = new WebSocket(finalWsUrl, {
            // bun WebSocket 支持 headers
            // @ts-expect-error
            headers: {
              Authorization: `Bearer ${apiKey}` // 使用选定的 API_KEY
            }
          });

          // 存储在 ws.data 中以便在其他事件处理程序中访问
          ws.data.finalServerWs = finalServerWs;
          ws.data.messageQueue = messageQueue;
          ws.data.connectionFailed = connectionFailed;

          // 设置连接超时
          const connectionTimeout = setTimeout(() => {
            if (finalServerWs.readyState !== WebSocket.OPEN) {
              console.log('Connection to final server timed out');
              ws.data.connectionFailed = true;

              // 发送超时错误消息
              try {
                let errorMessage = {
                  type: 'error',
                  error: 'connection_timeout',
                  message: 'Connection timeout, please check network or API Key'
                };

                ws.send(JSON.stringify(errorMessage));
              } catch (sendError) {
                console.error('Error sending timeout error message to client:', sendError);
              }

              // 清空消息队列
              if (ws.data.messageQueue.length > 0) {
                console.log(`Clearing ${ws.data.messageQueue.length} queued messages due to connection timeout`);
                ws.data.messageQueue.length = 0;
              }

              // 关闭连接
              finalServerWs.close();
            }
          }, 10000); // 10 秒超时

          // 存储超时处理器
          ws.data.connectionTimeout = connectionTimeout;

          // 设置最终服务器 WebSocket 事件处理程序
          finalServerWs.onopen = () => {
            console.log('Connected to final server');

            // 清除连接超时
            clearTimeout(ws.data.connectionTimeout);

            // 连接建立后，发送队列中的所有消息
            if (ws.data.messageQueue.length > 0 && !ws.data.connectionFailed) {
              console.log(`Sending ${ws.data.messageQueue.length} queued messages`);
              ws.data.messageQueue.forEach((msg: any) => {
                finalServerWs.send(msg);
              });
              // 清空队列
              ws.data.messageQueue.length = 0;
            }
          };

          finalServerWs.onmessage = event => {
            if (event.data instanceof Buffer) {
              ws.send(event.data.toString());
            } else {
              ws.send(event.data);
            }
          };

          finalServerWs.onclose = event => {
            console.log('Disconnected from final server');

            // 如果连接异常关闭（非正常关闭），发送错误消息
            if (event.code !== 1000) {
              try {
                console.log('最终服务器连接异常关闭');
                // 构建错误消息
                let errorMessage = {
                  type: 'error',
                  error: 'connection_closed',
                  message: 'Unable to connect to server, please check server address or API Key'
                };

                // 只有在 WebSocket 仍然开启状态时才发送
                ws.send(JSON.stringify(errorMessage));
              } catch (sendError) {
                console.error('Error sending close error message to client:', sendError);
              }
            }

            ws.close();
          };

          finalServerWs.onerror = error => {
            console.error('Error from final server:', error);
            ws.data.connectionFailed = true; // 标记连接失败

            // 清空消息队列，防止后续尝试发送
            if (ws.data.messageQueue.length > 0) {
              console.log(`Clearing ${ws.data.messageQueue.length} queued messages due to connection error`);
              ws.data.messageQueue.length = 0;
            }

            // 将错误信息发送给前端
            try {
              // 构建错误消息
              let errorMessage = {
                type: 'error',
                error: { code: 0, message: '' },
                message: ''
              };

              // 检查是否为特定错误（401、429等）
              try {
                // 安全地访问 error.message
                const errorMsg = (error as any).message || '';
                if (errorMsg.includes('401')) {
                  errorMessage.error = { code: 401, message: 'Invalid API Key' };
                  errorMessage.message = 'Invalid API Key, please check and try again';
                } else if (errorMsg.includes('429')) {
                  errorMessage.error = { code: 429, message: 'Rate limit exceeded' };
                  errorMessage.message = 'The connection through your private key has rejected due to the frequency or concurrency limits. You can try again later';
                } else {
                  errorMessage.error = { code: 0, message: 'Connection error' };
                  errorMessage.message = 'Error occurred while connecting to server';
                }
              } catch (e) {
                // 如果无法访问 error.message，使用默认错误消息
                errorMessage.error = { code: 0, message: 'Connection error' };
                errorMessage.message = 'Error occurred while connecting to server';
              }

              ws.send(JSON.stringify(errorMessage));
            } catch (sendError) {
              console.error('Error sending error message to client:', sendError);
            }
          };
        },
        message(ws: any, message: string | Buffer) {
          // 确保 ws.data 已初始化
          if (!ws.data) {
            console.error('ws.data is not initialized');
            return;
          }

          const finalServerWs = ws.data.finalServerWs;
          if (!finalServerWs) {
            console.error('finalServerWs is not initialized');
            return;
          }

          if (finalServerWs.readyState !== WebSocket.OPEN) {
            // 如果连接已失败，不要再添加消息到队列
            if (ws.data.connectionFailed) {
              console.log('Connection to final server failed, message discarded');
              return;
            }

            console.log('Cannot send message, connection to final server not open yet. Current state:', finalServerWs.readyState);
            // 将消息添加到队列
            if (typeof message === 'string') {
              ws.data.messageQueue.push(message);
            } else {
              const dataStr = message.toString();
              ws.data.messageQueue.push(dataStr);
            }
            return; // 如果连接未打开，不直接发送消息
          }

          if (typeof message === 'string') {
            finalServerWs.send(message);
          } else {
            finalServerWs.send(message.toString());
          }
        },
        close(ws: any, code: number, message: string) {
          console.log('Client disconnected');

          // 确保 ws.data 已初始化
          if (!ws.data) {
            return;
          }

          // 清空消息队列
          if (ws.data.messageQueue && ws.data.messageQueue.length > 0) {
            console.log(`Clearing ${ws.data.messageQueue.length} queued messages due to client disconnect`);
            ws.data.messageQueue.length = 0;
          }

          // 清除超时处理器
          if (ws.data.connectionTimeout) {
            clearTimeout(ws.data.connectionTimeout);
          }

          // 关闭最终服务器连接
          if (ws.data.finalServerWs) {
            ws.data.finalServerWs.close();
          }
        },
        drain(ws: any) {
          // 处理背压（当发送缓冲区已满时）
          // 使用 bufferedAmount 而不是 byteLength
          const bufferedAmount = ws.bufferedAmount || 0;
          console.log('WebSocket backpressure: ' + bufferedAmount);
        }
      }
    });

    console.log('实时语音 WebSocket 中转服务器已启动，监听端口 8080');
  } catch (error) {
    console.error('Error starting WebSocket server:', error);
    // 出错时清理可能部分创建的资源
    if (bunServer) {
      bunServer.stop(true);
      bunServer = null;
    }
  }
}

// Export the handle function (required for SvelteKit hooks)
export const handle = async ({ event, resolve }: any) => {
  return await resolve(event);
};
