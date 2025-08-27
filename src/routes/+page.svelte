<script lang="ts">
  import { browser } from '$app/environment';
  import { type RealtimeEvent, audioFormats, autoScroll, availableModels, debounce, defaultInstruction, voices } from '$lib';
  import { RealtimeClient } from '$lib/openai-realtime-api-beta';
  import type { AudioFormatType, ItemType } from '$lib/openai-realtime-api-beta/lib/client.js';
  import { WavRecorder, WavStreamPlayer } from '$lib/wavtools/index.js';
  import { ArrowDown, ArrowUp, BadgeInfo, Download, Mic, Pause, Play, Settings, X } from 'lucide-svelte';
  import { onDestroy, onMount, tick } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';

  // 添加自定义音色接口返回类型
  interface CustomVoice {
    id: string;
    file_id: string;
    created_at: number;
  }

  // 定义音频播放器类型
  interface AudioPlayer {
    wavesurfer: any;
    isPlaying: boolean;
    isLoading: boolean;
    hasError: boolean;
  }

  const sampleRate = 24000; // 音频采样率
  const wavRecorder = new WavRecorder({ sampleRate: sampleRate }); // 语音输入
  const wavStreamPlayer = new WavStreamPlayer({ sampleRate: sampleRate }); // 语音输出
  let client: RealtimeClient | null = null; // 实时语音 API 客户端

  let wsUrl = $state('wss://api.stepfun.com/v1/realtime'); // WebSocket URL 状态变量
  let modelName = $state(availableModels[0]); // 选定的模型
  let apiKey = $state(''); // API_KEY

  let items: Array<ItemType> = $state([]); // 对话
  let realtimeEvents: Array<RealtimeEvent> = $state([]); // 所有事件日志
  let expandedEvents: Record<string, boolean> = $state({}); // 展开的事件日志的 id
  let filterText = $state(''); // 过滤文本
  let filterSource = $state('all'); // 过滤来源：all, server, client
  let audioPlayers: Record<string, AudioPlayer> = $state({}); // 存储对话音频的播放器
  let isConnected = $state(false); // 是否已连接
  let isRecording = $state(false); // 是否正在录制
  let isAISpeaking = $state(false); // AI 是否正在说话
  let startTime = new Date().toISOString(); // 记录每次对话的开始时间
  let connectionError = $state(''); // 用于存储连接错误信息

  let selectedVoice = $state(voices[0]); // 选择的音色
  let allVoices = $state(voices); // 所有音色(系统音色+自定义音色)
  let instructions = $state(defaultInstruction); // 默认人设
  let newInstruction = $state((() => instructions)()); // 这是一个副本，用于在模态框中编辑，当点击确定时，将其赋值给 instruction，否则不会改变 instruction
  let temperature = $state(0.8); // 温度
  let conversationalMode = $state('manual'); // 会话模式，manual 或 realtime
  let inputAudioFormat = $state(audioFormats[0]); // 输入音频格式
  let outputAudioFormat = $state(audioFormats[0]); // 输出音频格式

  let instructionsModal: HTMLDialogElement; // 修改人设的模态框
  let settingsModal: HTMLDialogElement; // 设置的模态框

  // 获取自定义音色
  async function fetchCustomVoices() {
    if (!browser || !apiKey) return;
    try {
      // 从 wsUrl 中提取域名
      const domain = new URL(wsUrl).origin;
      // 将 ws:// 或 wss:// 转换为 http:// 或 https://
      const httpDomain = domain.replace('ws://', 'http://').replace('wss://', 'https://');
      const response = await fetch(`${httpDomain}/v1/audio/voices?limit=100`, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        console.log('获取自定义音色失败，状态码:', response.status);
        return;
      }

      const data = await response.json();
      if (data.object === 'list' && data.data) {
        // 将自定义音色添加到系统音色后面
        allVoices = [
          ...voices,
          ...data.data.map((voice: CustomVoice) => ({
            name: `自定义音色-${voice.id}`,
            value: voice.id
          }))
        ];

        // 如果当前选择的音色不存在于新列表中，重置为第一个音色
        if (!allVoices.some(v => v.value === selectedVoice.value)) {
          selectedVoice = allVoices[0];
        }
      }
    } catch (error) {
      console.log('获取自定义音色出错:', error);
    }
  }

  // 从 localStorage 加载保存的设置
  onMount(() => {
    if (browser) {
      const savedWsUrl = localStorage.getItem('wsUrl');
      const savedModelName = localStorage.getItem('modelName');
      const savedApiKey = localStorage.getItem('apiKey');

      if (savedWsUrl) wsUrl = savedWsUrl;
      if (savedModelName) modelName = savedModelName;
      if (savedApiKey) apiKey = savedApiKey;

      // 页面加载时获取自定义音色
      fetchCustomVoices();
    }
  });

  // 监听apiKey变化并重新获取自定义音色
  $effect(() => {
    if (browser) {
      localStorage.setItem('wsUrl', wsUrl);
      localStorage.setItem('modelName', modelName);
      localStorage.setItem('apiKey', apiKey);
      fetchCustomVoices();
    }
  });

  /**
   * 获取消息的文本内容
   */
  function getTextContent(item: ItemType): string | null {
    return item.formatted?.transcript || item.formatted?.text || item.content?.[0]?.transcript || item.content?.[0]?.text || null;
  }

  /**
   * 用于格式化日志时间
   */
  function formatTime(timestamp: string) {
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }

  /**
   * 初始化客户端
   */
  async function initClient() {
    await tick();
    // WebSocket 中转服务 url
    let wsProxyUrl = 'ws://127.0.0.1:8080';

    // 构建查询参数
    const params = new URLSearchParams();

    // 添加 API Key（如果有）
    if (apiKey) {
      params.append('apiKey', apiKey);
    }

    // 添加模型（如果有）
    if (modelName) {
      params.append('model', modelName);
    }

    // 添加 WebSocket URL（如果有）
    if (wsUrl) {
      // 对 URL 进行编码，确保它可以作为查询参数传递
      params.append('wsUrl', encodeURIComponent(wsUrl));
    }

    // 将查询参数添加到 URL
    const queryString = params.toString();
    if (queryString) {
      wsProxyUrl += `?${queryString}`;
    }

    client = new RealtimeClient({ url: wsProxyUrl });

    // 清除之前的错误信息
    connectionError = '';

    // 把收到和发出的消息都记录下来
    client?.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      // 限制记录的日志数量，避免占用太多内存，超过 3000 条的时候，就移除最前面的 1000 条
      if (realtimeEvents.length > 3000) {
        realtimeEvents.splice(0, 1000);
      }
      realtimeEvents.push(realtimeEvent);

      if (realtimeEvent.source === 'server') {
        if (realtimeEvent.event.type === 'response.done') {
          isAISpeaking = false;
        }

        // 检查是否是错误消息
        if (realtimeEvent.event.type === 'error') {
          console.error('Received error event:', realtimeEvent);

          // 确保断开连接
          if (isConnected && realtimeEvent.event.error === 'connection_closed') {
            connectionError = realtimeEvent.event.message || '连接发生错误';
            disconnectConversation();
          }
        }
      }
    });

    // 如果有错误，在控制台打印，并断开连接
    client?.on('error', (event: RealtimeEvent) => {
      console.error(' 错误事件：', event);

      // 检查是否是服务器发送的错误消息
      if (event && event.event && event.event.type === 'error') {
        connectionError = event.event.message || '连接发生错误';
        disconnectConversation(); // 断开连接
      }
    });

    // vad 模式下，检测到用户说话时，使 AI 停止说话
    client?.on('conversation.interrupted', async () => {
      const trackSampleOffset = wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        client?.cancelResponse(trackId, offset);
      }
    });

    // 收到新的对话消息时，播放 AI 说话的音频
    client?.on('conversation.updated', async (data: any) => {
      const { item, delta } = data;
      client?.conversation.cleanupItems(50); // 为了避免占用太多内存，只保留最近的 50 条消息
      items = client?.conversation.getItems() || [];
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
        isAISpeaking = true; // Set to true when audio is being played
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        // 记录为文件，可以再次播放，这个只能作用于用户发的消息
        const wavFile = await WavRecorder.decode(item.formatted.audio, sampleRate, sampleRate);
        item.formatted.file = wavFile;
        if (item.role === 'assistant') {
          // 将 items 中的最后一个，换成这个
          if (items.length) {
            items[items.length - 1] = item;
          }
        }
      }
    });

    items = client?.conversation.getItems() || [];
  }

  /**
   * 连接到对话 WebSocket 服务器
   */
  async function connectConversation() {
    // 如果没有填 api key，alert
    if (!apiKey) {
      alert('请填写 API Key 后再连接');
      return;
    }
    try {
      // 清除之前的错误信息
      connectionError = '';
      items = [];
      realtimeEvents = [];
      expandedEvents = {};
      audioPlayers = {};

      startTime = new Date().toISOString();
      await initClient();

      // 设置连接超时
      const connectionTimeout = setTimeout(() => {
        if (!isConnected && !connectionError) {
          connectionError = '连接超时，请稍后重试';
          disconnectConversation();
        }
      }, 10000); // 10 秒超时

      try {
        await wavRecorder.begin();
        await wavStreamPlayer.connect();
        await client?.connect();

        // 连接成功，清除超时
        clearTimeout(connectionTimeout);

        // 连接成功后，立即用当前选择的音色更新服务器会话
        if (client && selectedVoice?.value) {
          try {
            client.updateSession({ voice: selectedVoice.value });
            console.log('Session voice updated on reconnect:', selectedVoice.value);
          } catch (updateError) {
            console.error('Failed to update session voice on reconnect:', updateError);
          }
        }

        client?.sendUserMessageContent([
          {
            type: `input_text`,
            text: `你好！`
          }
        ]);

        // vad 模式
        if (client?.getTurnDetectionType() === 'server_vad') {
          await wavRecorder.record(data => client?.appendInputAudio(data.mono));
        }

        // 设置连接状态
        isConnected = true;
      } catch (innerError) {
        // 清除超时
        clearTimeout(connectionTimeout);
        throw innerError;
      }
    } catch (error) {
      console.error('Connection error:', error);
      connectionError = '连接失败，请重试';
      alert(connectionError);

      // 确保断开连接并重置状态
      client?.disconnect();
      client = null;
      await wavRecorder.end();
      wavStreamPlayer.interrupt();
      isConnected = false;
      return;
    }
  }

  /**
   * 断开连接并重置对话状态
   */
  async function disconnectConversation() {
    isConnected = false;

    client?.disconnect();
    await wavRecorder.end();
    wavStreamPlayer.interrupt();
    client = null;
    conversationalMode = 'manual';
    // 注意：这里不清除 connectionError，以便用户能看到错误信息
    // realtimeEvents = [];
    // items = [];
  }

  /**
   * 在手动按键通话模式下，开始录音
   */
  async function startRecording() {
    isRecording = true;

    // @ts-ignore - interrupt() 实际返回 Promise，但类型定义不正确
    const trackSampleOffset = await wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      client?.cancelResponse(trackId, offset);
      isAISpeaking = false; // 立即更新 AI 说话状态
    }
    await wavRecorder.record(data => client?.appendInputAudio(data.mono));
  }

  /**
   * 在手动按键通话模式下，停止录音
   */
  async function stopRecording() {
    isRecording = false;
    await wavRecorder.pause();
    client?.createResponse();
  }

  /**
   * 在手动 <> VAD 模式之间切换以进行通信
   */
  async function toggleVAD() {
    await tick();
    if (conversationalMode === 'manual' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    client?.updateSession({
      turn_detection: conversationalMode === 'manual' ? null : { type: 'server_vad' }
    });
    if (conversationalMode !== 'manual' && client?.isConnected()) {
      await wavRecorder.record(data => client?.appendInputAudio(data.mono));
    }
    isAISpeaking = false;
    isRecording = false;
  }

  // 切换音色
  async function changeVoice() {
    await tick(); // 先等待 tick，以确保 selectedVoice 已更新
    client?.updateSession({ voice: selectedVoice.value });
  }

  // 修改人设
  async function changeInstructions() {
    await tick(); // 先等待 tick，以确保 instructions 已更新
    client?.updateSession({ instructions });
  }

  // 修改温度
  async function changeTemperature() {
    await tick(); // 先等待 tick，以确保 selectedTemperature 已更新
    client?.updateSession({ temperature });
  }

  // 修改输入音频格式
  async function changeInputFormat() {
    await tick(); // 先等待 tick，以确保 selectedInputFormat 已更新
    client?.updateSession({ input_audio_format: inputAudioFormat as AudioFormatType });
  }

  // 修改输出音频格式
  async function changeOutputFormat() {
    await tick(); // 先等待 tick，以确保 selectedOutputFormat 已更新
    client?.updateSession({ output_audio_format: outputAudioFormat as AudioFormatType });
  }

  // Svelte action 用于初始化 WaveSurfer 实例
  function initWaveSurfer(node: string | HTMLElement, { id, url }: any) {
    // 确保 DOM 元素已存在后再初始化
    setTimeout(() => {
      if (!node) return;

      const wavesurfer = WaveSurfer.create({
        container: node,
        height: 24,
        waveColor: 'rgba(74, 131, 255, 0.6)',
        progressColor: '#1a56db',
        cursorColor: 'transparent',
        barWidth: 2,
        barGap: 1,
        barRadius: 3,
        normalize: true,
        minPxPerSec: 50, // 确保波形有足够的宽度
        interact: false, // 禁用点击波形跳转，只通过按钮控制
        hideScrollbar: true // 隐藏滚动条
      });

      wavesurfer.load(url);

      // 设置事件监听器
      wavesurfer.on('ready', () => {
        audioPlayers[id] = {
          wavesurfer,
          isPlaying: false,
          isLoading: false,
          hasError: false
        };
      });

      wavesurfer.on('error', () => {
        audioPlayers[id] = {
          wavesurfer,
          isPlaying: false,
          isLoading: false,
          hasError: true
        };
      });

      wavesurfer.on('finish', () => {
        const player = audioPlayers[id];
        if (player) {
          player.isPlaying = false;
        }
      });

      audioPlayers[id] = {
        wavesurfer,
        isPlaying: false,
        isLoading: true,
        hasError: false
      };
    }, 0);

    return {
      destroy() {
        const player = audioPlayers[id];
        if (player && player.wavesurfer) {
          player.wavesurfer.destroy();
          delete audioPlayers[id];
        }
      }
    };
  }

  // 播放或暂停音频
  function togglePlay(id: string) {
    const player = audioPlayers[id];
    if (!player || !player.wavesurfer || player.isLoading || player.hasError) return;

    if (player.isPlaying) {
      player.isPlaying = false;
      player.wavesurfer.pause();
    } else {
      player.isPlaying = true;
      player.wavesurfer.play();
    }
  }

  onDestroy(() => {
    client?.reset();
    // 清理所有 WaveSurfer 实例
    Object.values(audioPlayers).forEach(player => player.wavesurfer?.destroy());
  });

  // 切换事件详情的展开和折叠
  function toggleEventDetails(eventId: string) {
    expandedEvents[eventId] = (expandedEvents[eventId] ?? false) ? false : true;
  }

  // 过滤事件日志
  function filterEvents(events: Array<RealtimeEvent>) {
    if (!filterText && filterSource === 'all') return events;

    return events.filter(event => {
      // 根据来源过滤
      if (filterSource !== 'all' && event.source !== filterSource) return false;

      // 根据文本过滤
      if (filterText) {
        const lowerFilterText = filterText.toLowerCase();
        // 检查事件类型
        if (event.event.type.toLowerCase().includes(lowerFilterText)) return true;
        // 检查事件内容（转为字符串后搜索）
        if (JSON.stringify(event.event).toLowerCase().includes(lowerFilterText)) return true;
        return false;
      }

      return true;
    });
  }
  
  /**
   * 下载音频文件
   * @param url 音频文件URL
   * @param filename 保存的文件名
   */
  function downloadAudio(url: string, filename: string) {
    // 创建一个临时的a标签用于下载
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
</script>

<div class="bg-base-100 flex h-screen flex-col p-4">
  <!-- 页面顶部 连接、断开连接 按钮 -->
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-xl font-bold">Stepfun Realtime 实时对话体验</h1>
    <div class="flex items-center justify-end space-x-2">
      <!-- 显示连接错误信息 -->
      {#if connectionError}
        <div class="text-error ml-2 text-nowrap">{connectionError}</div>
      {/if}
      {#if !isConnected}
        <button onclick={() => settingsModal.showModal()} class="btn rounded-box mr-2">
          <Settings size={16} />
          服务器设置
        </button>
        <button onclick={debounce(connectConversation, 500)} class="btn btn-primary rounded-box">点击连接</button>
      {:else}
        <!-- TODO: 还没完成 -->
        <!-- <label class="select rounded-box mr-2 w-60">
          <span class="label">输入音频格式</span>
          <select bind:value={inputAudioFormat} onchange={changeInputFormat}>
            {#each audioFormats as format}
              <option value={format}>{format}</option>
            {/each}
          </select>
        </label>

        <label class="select rounded-box mr-2 w-60">
          <span class="label">输出音频格式</span>
          <select bind:value={outputAudioFormat} onchange={changeOutputFormat}>
            {#each audioFormats as format}
              <option value={format}>{format}</option>
            {/each}
          </select>
        </label> -->

        <label class="select rounded-box mr-2 w-60">
          <span class="label">切换音色</span>
          <select bind:value={selectedVoice} onchange={changeVoice}>
            {#each allVoices as voice}
              <option value={voice}>{voice.name}</option>
            {/each}
          </select>
        </label>

        <label class="select rounded-box mr-2 w-48">
          <span class="label">对话模式</span>
          <select bind:value={conversationalMode} onchange={toggleVAD}>
            <option value="manual">手动对话</option>
            <option value="realtime">实时对话</option>
          </select>
        </label>

        <label class="input rounded-box mr-2 w-48">
          <span class="label">温度</span>
          <input type="number" step="0.1" max="1.0" min="0.0" bind:value={temperature} onchange={changeTemperature} placeholder="修改温度" />
        </label>

        <button
          onclick={() => {
            newInstruction = instructions;
            instructionsModal.showModal();
          }}
          class="btn rounded-box mr-2"
        >
          修改人设
        </button>

        <button onclick={debounce(disconnectConversation, 500)} class="btn rounded-box bg-rose-500 text-slate-50">点击断开连接</button>
      {/if}
    </div>
  </div>

  <div class="flex h-full min-h-0 gap-2">
    <!-- 主要内容区域 -->
    <div class="bg-base-100 rounded-box flex flex-1 flex-col overflow-hidden border border-slate-300/20 shadow-md dark:border-slate-500/40">
      {#if !isConnected}
        <div class="flex h-full flex-col items-center justify-center text-center">
          <div class="mb-8 flex items-center justify-center gap-2">
            <BadgeInfo class="size-5" />
            <h3 class="text-lg font-semibold">开始实时对话体验</h3>
          </div>
          <ol class="list-inside list-decimal text-left">
            <li class="mb-4">
              <span class="font-semibold">设置服务器信息：</span>
              点击 "服务器设置" 按钮，填写服务器地址、模型和 API Key
            </li>
            <li>
              <span class="font-semibold">连接到服务器：</span>
              点击 "点击连接" 按钮，即可开始实时对话
            </li>
          </ol>
        </div>
      {:else}
        <!-- AI 圆圈形象 -->
        <div class="flex flex-col items-center justify-center p-8">
          <div
            class="relative flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-tr shadow-lg transition-all duration-300
				{isAISpeaking ? 'from-pink-500 to-rose-500' : isRecording ? 'from-blue-500 to-rose-500' : 'from-pink-300 to-rose-400'}"
            style:transform={isAISpeaking ? 'scale(1.05)' : 'scale(1)'}
            style:animation={isAISpeaking ? 'pulse 1.5s infinite ease-in-out' : 'none'}
          >
            <span class="text-lg font-medium text-white">
              {#if isRecording}
                Listening...
              {:else if isAISpeaking}
                Speaking
              {:else}
                AI
              {/if}
            </span>
          </div>
        </div>

        <!-- 对话历史 -->
        <div class="flex-1 space-y-4 overflow-y-auto p-2" use:autoScroll>
          {#each items as item}
            <div class="rounded-box flex flex-col p-2 {item.role === 'user' ? 'dark:bg-base-200 ml-auto bg-blue-100' : 'bg-base-200 mr-auto'} min-h-18 max-w-[80%]">
              <div class="mb-1 font-semibold {item.role === 'user' ? 'text-blue-700 dark:text-blue-400' : 'text-rose-400'}">
                <div class="flex items-center gap-2">
                  <span>{item.role === 'user' ? 'You' : 'AI'}</span>
                  {#if item.formatted?.file}
                    <div class="bg-base-300/80 group flex h-6 w-48 items-center gap-2 overflow-hidden rounded-lg px-2 transition-all duration-200 hover:shadow">
                      <button
                        class="transition-colors duration-200 hover:scale-110 hover:cursor-pointer"
                        onclick={() => togglePlay(item.id)}
                        title={audioPlayers[item.id]?.isPlaying ? '暂停' : '播放'}
                        disabled={audioPlayers[item.id]?.isLoading || audioPlayers[item.id]?.hasError}
                      >
                        {#if audioPlayers[item.id]?.isLoading}
                          <div class="loading loading-spinner loading-xs"></div>
                        {:else if audioPlayers[item.id]?.isPlaying}
                          <Pause size={14} />
                        {:else}
                          <Play size={14} />
                        {/if}
                      </button>
                      <div id="waveform-{item.id}" class="flex-1 overflow-hidden rounded-lg {audioPlayers[item.id]?.hasError ? 'opacity-50' : ''}" use:initWaveSurfer={{ id: item.id, url: item.formatted.file.url }}></div>
                      <button class="opacity-0 transition-colors duration-200 group-hover:opacity-100 hover:scale-110 hover:cursor-pointer" onclick={() => downloadAudio(item.formatted.file.url, `audio-${item.id}.wav`)} title="下载音频">
                        <Download size={14} />
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
              <div>
                {#if getTextContent(item)}
                  <p>{getTextContent(item)}</p>
                {:else}
                  <div class="skeleton h-4 w-32"></div>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- 按住说话 按钮 -->
        <div class="border-base-300/50 border-t p-2">
          {#if isConnected}
            {#if conversationalMode === 'manual'}
              <div class="flex justify-center">
                <button
                  onmousedown={startRecording}
                  onmouseup={stopRecording}
                  onmouseleave={isRecording ? stopRecording : null}
                  class="flex h-16 w-16 items-center justify-center rounded-full {isRecording ? 'bg-emerald-500' : 'bg-blue-500'} text-white shadow-lg transition-colors hover:opacity-90 focus:outline-none"
                >
                  {#if isRecording}
                    <ArrowUp />
                  {:else}
                    <Mic />
                  {/if}
                </button>
              </div>
              <div class="mt-2 text-center text-sm">
                {isRecording ? '松手发送' : '按住说话'}
              </div>
            {:else}
              <div class="flex items-center justify-center">实时对话中……</div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- 调试事件日志 -->
    <div class="bg-base-100 rounded-box flex max-h-full min-h-0 w-1/3 min-w-72 flex-col overflow-hidden border border-slate-300/20 shadow-md dark:border-slate-500/40">
      <div class="flex h-12 items-center justify-between p-2">
        <h2 class="text-xl font-semibold">调试日志</h2>
        <div>
          {#if realtimeEvents.length > 0}
            <button class="btn btn-sm" onclick={() => (expandedEvents = {})}>全部折叠</button>
          {/if}
          {#if realtimeEvents.length > 0}
            <button
              class="btn btn-sm"
              onclick={() => {
                expandedEvents = {};
                realtimeEvents = [];
              }}
            >
              清掉
            </button>
          {/if}
        </div>
      </div>
      <!-- 过滤控制区域 -->
      {#if realtimeEvents.length > 0}
        <div class="border-base-300 flex items-center gap-2 border-b p-2">
          <select class="select select-sm select-bordered w-32" bind:value={filterSource}>
            <option value="all">全部来源</option>
            <option value="server">服务器</option>
            <option value="client">客户端</option>
          </select>
          <div class="relative flex-1">
            <input type="text" class="input input-sm input-bordered w-full pr-8" placeholder="输入关键词过滤日志" bind:value={filterText} />
            {#if filterText}
              <button
                class="absolute top-1/2 right-2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200 text-slate-500 hover:bg-slate-300 hover:text-slate-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                onclick={() => (filterText = '')}
              >
                <X size={16} />
              </button>
            {/if}
          </div>
        </div>
      {/if}
      <div class="min-h-0 flex-1 overflow-y-auto p-2 text-sm" use:autoScroll>
        {#if realtimeEvents.length === 0}
          <div class="flex h-full items-center justify-center text-center">暂无调试日志</div>
        {:else if filterEvents(realtimeEvents).length === 0}
          <div class="flex h-full items-center justify-center text-center">没有匹配的日志</div>
        {:else}
          {#each filterEvents(realtimeEvents) as event, i (event.time + '-' + i)}
            <div class="border-base-300/40 mb-1 border-b py-1">
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="flex cursor-pointer items-center justify-between" onclick={() => toggleEventDetails(`${i}`)}>
                <div class="flex min-w-0 items-center">
                  <span class="mr-2 font-mono">{formatTime(event.time)}</span>
                  <span class="{event.source === 'server' ? 'text-purple-600 dark:text-purple-400' : 'text-blue-600 dark:text-blue-400'} font-medium">
                    {event.source}
                  </span>
                  <span class="ml-2 max-w-2/3 truncate text-wrap">{event.event.type}</span>
                </div>
                <div>
                  {#if expandedEvents[`${i}`]}
                    <ArrowUp size={16} />
                  {:else}
                    <ArrowDown size={16} />
                  {/if}
                </div>
              </div>
              {#if expandedEvents[`${i}`]}
                <pre class="bg-base-200 mt-1 overflow-x-auto rounded p-2 text-xs">{JSON.stringify(event.event, null, 2)}</pre>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

<dialog bind:this={instructionsModal} class="modal">
  <div class="modal-box">
    <h2 class="mb-4 text-lg font-semibold">修改人设</h2>
    <textarea bind:value={newInstruction} class="border-base-300 rounded-box mb-4 h-64 w-full border p-2"></textarea>
    <div class="flex justify-end gap-2">
      <button onclick={() => instructionsModal.close()} class="btn rounded-box">取消</button>
      <button
        class="btn btn-primary rounded-box"
        onclick={() => {
          instructions = newInstruction;
          changeInstructions();
          instructionsModal.close();
        }}
      >
        确定
      </button>
    </div>
  </div>
</dialog>

<!-- 新增服务器设置模态框 -->
<dialog bind:this={settingsModal} class="modal">
  <div class="modal-box">
    <h2 class="mb-4 text-lg font-semibold">服务器设置</h2>
    <div class="space-y-4">
      <label class="input rounded-box w-full">
        <span class="label w-32">服务器 URL</span>
        <input type="text" placeholder="服务器地址" bind:value={wsUrl} disabled={isConnected} />
      </label>

      <label class="select rounded-box w-full">
        <span class="label w-32">模型</span>
        <select bind:value={modelName} disabled={isConnected}>
          {#each availableModels as model}
            <option value={model}>{model}</option>
          {/each}
        </select>
      </label>

      <label class="input rounded-box w-full">
        <span class="label w-32">API Key</span>
        <input type="text" placeholder="API Key" bind:value={apiKey} disabled={isConnected} />
      </label>
    </div>

    <div class="modal-action">
      <button onclick={() => settingsModal.close()} class="btn rounded-box">确定</button>
    </div>
  </div>
</dialog>
