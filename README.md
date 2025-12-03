# 阶跃星辰实时语音控制台 (Stepfun Realtime Console)

中文 | [English](README-en.md)

## 项目描述

这是一个基于阶跃星辰实时语音 API 的前端演示项目，用于展示和测试阶跃星辰的实时语音对话功能。通过该项目，用户可以体验实时语音交互以及相关功能的调试与测试。项目提供了友好的用户界面，方便开发者和测试人员快速上手并了解阶跃星辰实时 API 的各项功能和特性。

## 功能特点

- **实时语音交互**：支持实时语音输入和输出，实现流畅的人机对话体验
- **可视化音频波形**：使用 WaveSurfer.js 实现音频波形可视化
- **自定义 AI 人设**：可以自定义 AI 的指令和人设，调整对话风格
- **调试日志**：提供详细的调试日志，方便开发者追踪 API 调用和响应过程

## 技术栈

- **前端框架**：
  - Svelte 5 - 响应式前端框架
  - SvelteKit - 基于 Svelte 的服务端渲染 (SSR) 框架，类似于 Next.js 和 Nuxt.js，提供路由、服务端渲染和 API 端点等功能
- **样式**：Tailwind CSS 4 - 实用优先的 CSS 框架
- **UI 组件**：DaisyUI - 基于 Tailwind CSS 的组件库
- **音频处理**：WaveSurfer.js - 音频可视化库
- **构建工具**：Vite - 现代前端构建工具
- **运行时**：Bun - 高性能 JavaScript 运行时
- **语言**：TypeScript - 类型安全的 JavaScript 超集
- **WebSocket**：Bun 原生 WebSocket - 用于实时通信

## 安装与使用方法

### 前置条件

- 安装 Bun 运行时（必须，由于采用了 Bun 原生 WebSocket，因此不兼容 Node.js）

### 安装步骤

1. 安装 Bun 运行时：

   ```bash
   npm install -g bun
   ```

2. 克隆项目并进入项目目录：

   ```bash
   git clone https://github.com/stepfun-ai/Step-Realtime-Console
   cd Step-Realtime-Console
   ```

3. 安装项目依赖：

   ```bash
   bun install
   ```

4. 运行开发服务器：

   ```bash
   bun dev
   ```

   项目将在 5173 端口运行（如被占用则顺序后延），同时 WebSocket 中转服务将在 8080 端口运行，请确保这些端口未被其他应用占用。请注意控制台输出的实际端口信息。

5. 在浏览器中访问：
   ```
   http://localhost:5173
   ```

### 构建生产版本

```bash
bun run build
```

构建后的文件将位于`build`目录中，您可通过`bun build/`来启动服务，注意最后的`/`不可省略，这条命令的完整版本其实是`bun build/index.js`。服务将在 3000 端口运行。

如果您想自定义服务端口，可通过环境变量的方式，例如`PORT=3001 bun build/`，则服务会在 3001 端口运行。

## 首次使用说明

### 开发时首次加载

开发时项目第一次页面加载时可能会比较慢，这是因为项目使用了 Lucide 图标库，该库在首次编译时需要较长时间进行处理，属于正常现象，请耐心等待。这种情况仅发生在开发阶段，生产版本不会有此问题。

### 配置服务

成功运行项目后，您需要在界面中点击**服务器设置**按钮并配置以下信息：

1. **服务器地址**：wss://api.stepfun.com/v1/realtime

2. **模型名称**：当前支持step-audio-2、step-audio-2-mini、step-audio-2-think、step-audio-2-mini-think 共四个版本模型

3. **API Key**：您需要通过阶跃星辰开放平台获取 API 密钥。请访问 [阶跃星辰开放平台](https://platform.stepfun.com/) 注册并获取您的 API Key。

4. **Voice**：音色设置（必填）。请填写您想要使用的音色值，例如：qingchunshaonv、wenrounansheng 等。

填写完成后，您就可以开始体验实时语音交互功能了。

## 项目结构

```
realtime-console-demo/
├── src/                    # 源代码目录
│   ├── lib/                # 库文件
│   │   ├── openai-realtime-api-beta/  # openai 的实时语音 sdk 的修改版本，用于便捷管理实时语音事件
│   │   ├── wavtools/       # 音频处理工具
│   │   └── ...             # 其他工具和组件
│   ├── routes/             # 页面路由
│   │   ├── +layout.svelte  # 布局组件
│   │   └── +page.svelte    # 主页面组件
│   ├── app.css             # 全局样式
│   ├── app.html            # HTML模板
│   └── hooks.server.ts     # 服务器钩子，用以启动 Bun WebSocket 服务器，中转 WebSocket 连接
├── static/                 # 静态资源
├── build/                  # 构建输出目录
├── package.json            # 项目配置
├── svelte.config.js        # Svelte配置
├── tsconfig.json           # TypeScript配置
├── vite.config.ts          # Vite配置
└── README.md               # 项目说明
```

## WebSocket 中转说明

本项目使用服务器中转 WebSocket 连接的方式与阶跃星辰实时 API 进行通信。这是因为浏览器原生 WebSocket 不支持在 headers 字段中传输信息，而阶跃星辰实时 API 需要在 header 中传输用户的 API Key 进行身份验证。

在 `hooks.server.ts` 文件中，我们实现了一个中间服务器，用于：

1. 接收来自前端的 WebSocket 连接
2. 创建一个新的 WebSocket 连接到阶跃星辰实时 API 服务器，并在 header 中添加 API Key
3. 在两个 WebSocket 连接之间转发消息

**安全建议**：在实际开发中，强烈建议开发者也采用类似的中间服务器方式中转 WebSocket 连接，避免在前端直接使用 API Key，从而减少 API Key 暴露的风险。这种方式可以有效保护用户的 API Key 安全，防止被恶意利用。

## 关于 openai-realtime-api-beta

本项目中使用的 `openai-realtime-api-beta` 目录是基于 OpenAI 提供的实时语音 SDK 的修改版本（原仓库：[https://github.com/openai/openai-realtime-api-beta](https://github.com/openai/openai-realtime-api-beta)）。阶跃星辰致力于与其他 AI 厂商共建生态，因此采用了兼容 OpenAI 的 API 接口规范。

由于 OpenAI 的这个库自 2024 年 12 月起就没有再更新，且其中以硬编码方式固定了一部分模型信息，为了满足我们的开发需求，我们将其放入本仓库并进行了适当修改，以支持阶跃星辰的实时语音 API 特性。

我们对 OpenAI 提供的原始 SDK 表示感谢，同时也欢迎开发者基于我们的修改版本进行进一步的定制和优化。

## API 使用说明

本项目使用阶跃星辰实时语音 API，主要功能包括：

1. **建立 WebSocket 连接**：连接到阶跃星辰实时 API 服务器
2. **语音输入**：支持实时语音输入，自动转写为文本
3. **AI 响应**：获取 AI 的实时文本和语音响应

### 主要 API 参数

- **Model Name**：选择不同的 AI 模型
- **Voice**：设置 AI 的语音音色（必填）
- **System Prompt**：自定义 AI 的行为和全局指令

## 注意事项

1. **Bun 运行时**：本项目使用了 Bun 原生的 WebSocket，因此不兼容 Node.js 环境，必须使用 Bun 运行
2. **Bun 版本**：确保您的 Bun 版本在 1.2 以上，如果不是，请通过 `bun upgrade` 升级
3. **API 密钥**：使用时需要配置有效的 API 密钥
4. **音频设备**：使用时请确保麦克风权限已授予浏览器

## 第三方库版权声明

### wavesurfer.js

BSD 3-Clause License

Copyright (c) 2012-2023, katspaugh and contributors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

- Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
