<script lang="ts">
  import { browser } from '$app/environment';
  import { type RealtimeEvent, autoScroll, availableModels, debounce, defaultInstruction, voices, step1oVoice, getInstruction, isDefaultInstruction } from '$lib';
  import { RealtimeClient } from '$lib/openai-realtime-api-beta';
  import type { ItemType } from '$lib/openai-realtime-api-beta/lib/client.js';
  import { WavRecorder, WavStreamPlayer } from '$lib/wavtools/index.js';
  import { ArrowUp, ChevronDown, ChevronUp, BadgeInfo, ArrowDown, Download, Mic, Pause, Play, Settings, X } from 'lucide-svelte';
  import { onDestroy, onMount, tick } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';

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

  let wsUrl = $state('wss://api.stepfun.com/v1/realtime'); // WebSocket URL state variable
  let modelName = $state(availableModels[0]); // Selected model
  let apiKey = $state(''); // API_KEY
  let apiKeyType = $state('private');

  let items: Array<ItemType> = $state([]); // Conversation items
  let realtimeEvents: Array<RealtimeEvent> = $state([]); // All event logs
  let expandedEvents: Record<string, boolean> = $state({}); // Expanded event log IDs
  let filterText = $state(''); // Filter text
  let filterSource = $state('all'); // Filter source: all, server, client
  let audioPlayers: Record<string, AudioPlayer> = $state({}); // Store conversation audio players
  let isConnected = $state(false); // Connection status
  let isRecording = $state(false); // Recording status
  let isAISpeaking = $state(false); // AI speaking status
  let isThinking = $state(false); // Thinking status
  let thinkingStates: Record<string, { isExpanded: boolean; isCompleted: boolean }> = $state({}); // Thinking states
  let isResponseInProgress = $state(false); // Whether a response is currently being generated
  let isProcessingRecording = $state(false); // Prevent duplicate recording operations
  let startTime = new Date().toISOString(); // Record conversation start time
  let connectionError = $state(''); // Store connection error messages

  let instructions = $state(defaultInstruction); // Default persona
  let newInstruction = $state((() => instructions)()); // Copy for editing in modal
  let conversationalMode = $state('manual'); // Conversation mode: manual or realtime

  let instructionsModal: HTMLDialogElement; // System prompt modal
  let settingsModal: HTMLDialogElement; // Settings modal
  let selectedVoice = $state(voices[0]); // Selected voice tone
  let availableVoices = $state(voices); // Available voice list (dynamic)

  // Load saved settings from localStorage
  onMount(() => {
    if (browser) {
      const savedWsUrl = localStorage.getItem('wsUrl');
      const savedModelName = localStorage.getItem('modelName');
      const savedApiKey = localStorage.getItem('apiKey');
      const savedApiKeyType = localStorage.getItem('apiKeyType');
      const savedVoice = localStorage.getItem('selectedVoice');

      if (savedWsUrl) wsUrl = savedWsUrl;
      if (savedModelName) modelName = savedModelName;
      if (savedApiKey) apiKey = savedApiKey;
      if (savedApiKeyType) apiKeyType = savedApiKeyType;
      if (savedVoice) {
        const voice = voices.find(v => v.value === savedVoice);
        if (voice) selectedVoice = voice;
      }
    }
  });

  onDestroy(() => {
    client?.reset();
    // 清理所有 WaveSurfer 实例
    Object.values(audioPlayers).forEach(player => player.wavesurfer?.destroy());
  });

  $effect(() => {
    if (browser) {
      localStorage.setItem('wsUrl', wsUrl);
      localStorage.setItem('modelName', modelName);
      localStorage.setItem('apiKey', apiKey);
      localStorage.setItem('apiKeyType', apiKeyType);
      localStorage.setItem('selectedVoice', selectedVoice.value);
    }
  });

  // 根据模型切换音色列表
  $effect(() => {
    if (modelName === 'step-1o-audio') {
      availableVoices = step1oVoice;
      // 如果当前选中的音色不在新列表中，切换到第一个
      if (!step1oVoice.find(v => v.value === selectedVoice.value)) {
        selectedVoice = step1oVoice[0];
      }
    } else {
      availableVoices = voices;
      // 如果当前选中的音色不在新列表中，切换到第一个
      if (!voices.find(v => v.value === selectedVoice.value)) {
        selectedVoice = voices[0];
      }
    }
  });

  /**
   * 获取消息的文本内容
   */
  function getTextContent(item: ItemType): string | null {
    const text = item.formatted?.transcript || item.formatted?.text || item.content?.[0]?.transcript || item.content?.[0]?.text || '';
    if (text.startsWith('undefined')) {
      return text.replace('undefined', '');
    }
    return text;
  }

  function getThinkContent(item: ItemType): string | null {
    // return getTextContent(item); // TODO
    return item.formatted?.think || item.content?.[0]?.think || null;
  }

  /**
   * 切换思考过程的展开/收起状态
   */
  function toggleThinkingExpansion(itemId: string) {
    if (!thinkingStates[itemId]) {
      thinkingStates[itemId] = { isExpanded: true, isCompleted: false };
    }
    thinkingStates[itemId].isExpanded = !thinkingStates[itemId].isExpanded;
  }

  function isThinkingCompleted(item: ItemType): boolean {
    return thinkingStates[item?.id]?.isCompleted || false;
  }

  /**
   * 获取思考过程的显示文本
   */
  function getThinkingDisplayText(item: ItemType): string {
    const isCompleted = isThinkingCompleted(item);
    return isCompleted ? '已深度思考' : '思考过程';
  }

  /**
   * 安全地创建响应，避免重复调用
   */
  function safeCreateResponse() {
    if (isResponseInProgress) {
      return false;
    }

    client?.createResponse();
    return true;
  }

  /**
   * 安全地开始音频输入，如果有响应正在进行中则先取消
   */
  async function safeStartAudioInput(callback: () => Promise<void>) {
    // 用户开始说话时，总是先中断AI的音频播放
    const trackSampleOffset = await wavStreamPlayer.interrupt();

    // 如果有正在进行的响应，取消它
    if (isResponseInProgress && trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      client?.cancelResponse(trackId, offset);

      // 等待 response.cancel 事件确认，或者 isResponseInProgress 变为 false
      await new Promise<void>(resolve => {
        const checkInterval = setInterval(() => {
          if (!isResponseInProgress) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 10);

        // 超时保护，最多等待1秒
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 1000);
      });
    }

    // 确保重置AI说话状态
    isAISpeaking = false;

    // 确保录音器处于正确的状态
    if (wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }

    await callback();
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
      let s = `${n}`;
      while (s.length < 2) {
        s = `0${s}`;
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
    let wsProxyUrl = 'wss://realtime-console.stepfun.com/ws';

    // 构建查询参数
    const params = new URLSearchParams();

    // 添加 API Key（如果是私钥模式）
    if (apiKeyType === 'private' && apiKey) {
      params.append('apiKey', apiKey);
    }

    // 添加 API Key 类型
    params.append('apiKeyType', apiKeyType);

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

    // Combine hidden system prompt with user instructions
    const combinedInstructions = `${getInstruction(modelName)}`;
    client = new RealtimeClient({
      url: wsProxyUrl,
      instructions: combinedInstructions,
      voice: selectedVoice.value
    });

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
        if (realtimeEvent.event.type === 'response.done' || realtimeEvent.event.type === 'response.audio.done' || realtimeEvent.event.type === 'response.output_item.done') {
          isAISpeaking = false;
          isResponseInProgress = false;
        } else if (realtimeEvent.event.type === 'response.created') {
          isResponseInProgress = true;
        }

        if (realtimeEvent.event.type === 'response.thinking.done') {
          const { item_id } = realtimeEvent.event;
          thinkingStates[item_id] = { isExpanded: false, isCompleted: true };
          isThinking = false;
        }
        if (realtimeEvent.event.type === 'response.thinking.delta') {
          const { item_id } = realtimeEvent.event;
          thinkingStates[item_id] = { isExpanded: true, isCompleted: false };
          isThinking = true;
        }
      }

      if (realtimeEvent.source === 'client') {
        if (realtimeEvent.event.type === 'response.cancel') {
          isResponseInProgress = false;
        }
      }

      if (realtimeEvent.source === 'server') {
        // 检查是否是错误消息
        if (realtimeEvent.event.type === 'error') {
          const errorMessage = realtimeEvent.event.error?.message || '';
          const errorCode = realtimeEvent.event.error?.code;

          // 忽略竞争条件导致的无害错误
          if (errorMessage === 'no ongoing response to cancel') {
            return;
          }

          console.error('Received error event:', realtimeEvent);

          // 处理429错误码
          if (errorCode === 429) {
            connectionError = 'The connection through your private key has rejected due to the frequency or concurrency limits. You can try again later';
          } else {
            connectionError = realtimeEvent.event.error?.message || realtimeEvent.event.message || 'Unable to connect to server, please check server address or API Key';
          }

          // 确保断开连接 - 处理所有错误类型
          if (isConnected) {
            disconnectConversation();

            // 显示错误弹窗
            alert(connectionError);
          }
        }
      }
    });

    // 如果有错误，在控制台打印，并断开连接
    client?.on('error', (event: RealtimeEvent) => {
      console.error(' 错误事件：', event);

      // 检查是否是服务器发送的错误消息
      if (event?.event && event.event.type === 'error') {
        // 处理后端发送的结构化错误信息
        const errorObj = event.event.error;
        const errorMessage = event.event.message;

        // 如果有结构化的错误对象（从后端WebSocket服务器发送的）
        if (errorObj && typeof errorObj === 'object' && errorObj.code) {
          connectionError = errorMessage || 'Unable to connect to server, please check server address or API Key';
        } else {
          // 处理其他类型的错误
          connectionError = errorMessage || 'Unable to connect to server, please check server address or API Key';
        }

        disconnectConversation(); // 断开连接

        // 显示错误弹窗
        alert(connectionError);
      }
    });

    // vad 模式下，检测到用户说话时，使 AI 停止说话
    client?.on('conversation.interrupted', async () => {
      const trackSampleOffset = wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId && isAISpeaking) {
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
    // 如果选择了私钥但没有填写，alert
    if (apiKeyType === 'private' && !apiKey) {
      alert('Please fill in API Key before connecting');
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
          connectionError = 'Connection timeout, please try again later';
          disconnectConversation();
        }
      }, 10000); // 10 秒超时

      try {
        await wavRecorder.begin();
        await wavStreamPlayer.connect();
        await client?.connect();

        // 连接成功，清除超时
        clearTimeout(connectionTimeout);

        if (!modelName.includes('think')) {
          client?.sendUserMessageContent([
            {
              type: `input_text`,
              text: `Hello!`
            }
          ]);
        }

        // vad 模式
        if (client?.getTurnDetectionType() === 'server_vad') {
          await safeStartAudioInput(async () => {
            // 检查录音器状态，避免重复调用
            if (wavRecorder.getStatus() !== 'recording') {
              await wavRecorder.record(data => client?.appendInputAudio(data.mono));
            }
          });
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
      connectionError = 'Unable to connect to server, please check server address or API Key';
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
    isResponseInProgress = false;
    isAISpeaking = false;
    isRecording = false;
    isProcessingRecording = false;

    client?.disconnect();
    await wavRecorder.end();
    wavStreamPlayer.interrupt();
    client = null;
    conversationalMode = 'manual';
    // 注意：这里不清除 connectionError，以便用户能看到错误信息
  }

  /**
   * 在手动按键通话模式下，开始录音
   */
  async function startRecording() {
    if (isProcessingRecording) {
      return;
    }

    isProcessingRecording = true;
    isRecording = true;

    try {
      await safeStartAudioInput(async () => {
        // 检查录音器状态，避免重复调用
        if (wavRecorder.getStatus() !== 'recording') {
          await wavRecorder.record(data => client?.appendInputAudio(data.mono));
        }
      });
    } finally {
      isProcessingRecording = false;
    }
  }

  /**
   * 在手动按键通话模式下，停止录音
   */
  async function stopRecording() {
    if (isProcessingRecording) {
      return;
    }

    isProcessingRecording = true;
    isRecording = false;

    try {
      // 检查录音器状态，避免重复调用pause
      if (wavRecorder.getStatus() === 'recording') {
        await wavRecorder.pause();
      }

      // 使用安全的createResponse函数
      safeCreateResponse();
    } finally {
      isProcessingRecording = false;
    }
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
      await safeStartAudioInput(async () => {
        // 检查录音器状态，避免重复调用
        if (wavRecorder.getStatus() !== 'recording') {
          await wavRecorder.record(data => client?.appendInputAudio(data.mono));
        }
      });
    }
    isAISpeaking = false;
    isRecording = false;
  }

  // Update system prompt
  async function changeInstructions() {
    await tick(); // Wait for tick to ensure instructions are updated
    const combinedInstructions = `${getInstruction(modelName)}`;
    client?.updateSession({ instructions: combinedInstructions });
  }

  // Update voice when selection changes
  async function updateVoice() {
    if (client?.isConnected()) {
      client?.updateSession({ voice: selectedVoice.value });
    }
  }

  // Svelte action 用于初始化 WaveSurfer 实例
  function initWaveSurfer(node: string | HTMLElement, { id, url }: any) {
    // 确保 DOM 元素已存在后再初始化
    setTimeout(() => {
      if (!node) return;

      const wavesurfer = WaveSurfer.create({
        container: node,
        height: 20,
        waveColor: 'rgba(74, 131, 255, 0.6)',
        progressColor: '#1a56db',
        cursorColor: 'transparent',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        minPxPerSec: 40, // 稍微减小以适应移动端
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
        if (player?.wavesurfer) {
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

<div class="bg-base-100 mx-auto flex h-screen max-w-7xl flex-col p-2 sm:p-4">
  <!-- 页面顶部 连接、断开连接 按钮 -->
  <div class="mb-2 flex flex-col items-start justify-between gap-2 sm:mb-4 sm:flex-row sm:items-center sm:gap-0">
    <h1 class="text-lg font-bold sm:text-xl">Stepfun Audio</h1>
    <div class="flex w-full flex-col items-start justify-end space-y-2 sm:w-auto sm:flex-row sm:items-center sm:space-y-0 sm:space-x-2">
      <!-- 显示连接错误信息 -->
      {#if connectionError}
        <div class="text-error bg-error/10 mb-2 w-full rounded p-2 text-xs break-words sm:mb-0 sm:ml-2 sm:w-auto sm:rounded-none sm:bg-transparent sm:p-0 sm:text-sm sm:text-nowrap">{connectionError}</div>
      {/if}

      <!-- Always visible settings -->
      <label class="select rounded-box mb-2 w-full sm:mr-2 sm:mb-0 sm:w-72 md:w-72">
        <span class="label text-sm">Voice Tone</span>
        <select bind:value={selectedVoice} onchange={updateVoice}>
          {#each availableVoices as voice}
            <option value={voice}>{voice.name}</option>
          {/each}
        </select>
      </label>

      <!-- VAD mode toggle - only show when connected -->
      {#if isConnected}
        <label class="select rounded-box mb-2 w-full sm:mr-2 sm:mb-0 sm:w-72 md:w-72">
          <span class="label text-sm">Mode</span>
          <select bind:value={conversationalMode} onchange={toggleVAD}>
            <option value="manual">Manual (Push to Talk)</option>
            <option value="vad">Voice Activity Detection</option>
          </select>
        </label>
      {/if}

      <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <button
          onclick={() => {
            if (isDefaultInstruction(newInstruction)) {
              newInstruction = getInstruction(modelName);
            }
            instructionsModal.showModal();
          }}
          class="btn rounded-box h-10 px-2 text-xs sm:px-4 sm:text-sm"
        >
          <span class="hidden sm:inline">System Prompt Setting</span>
          <span class="sm:hidden">System Prompt</span>
        </button>

        {#if !isConnected}
          <button onclick={() => settingsModal.showModal()} class="btn rounded-box h-10 px-2 text-xs sm:px-4 sm:text-sm">
            <Settings size={14} class="sm:hidden" />
            <Settings size={16} class="hidden sm:inline" />
            <span class="ml-1 hidden sm:inline">Server Setting</span>
            <span class="ml-1 sm:hidden">Server</span>
          </button>
          <button onclick={debounce(connectConversation, 500)} class="btn btn-primary rounded-box h-10 px-4 text-sm sm:px-6 sm:text-base">Connect</button>
        {:else}
          <button onclick={debounce(disconnectConversation, 500)} class="btn rounded-box h-10 bg-rose-500 px-4 text-sm text-slate-50 sm:px-6 sm:text-base">Disconnect</button>
        {/if}
      </div>
    </div>
  </div>

  <div class="flex h-full min-h-0 gap-1 sm:gap-2">
    <!-- 主要内容区域 -->
    <div class="bg-base-100 rounded-box flex flex-1 flex-col overflow-hidden border border-slate-300/20 shadow-md dark:border-slate-500/40">
      {#if !isConnected}
        <div class="flex h-full flex-col items-center justify-center p-4 text-center sm:p-8">
          <div class="mb-4 flex items-center justify-center gap-2 sm:mb-8">
            <BadgeInfo class="size-4 sm:size-5" />
            <h3 class="text-base font-semibold sm:text-lg">Start Your Audio Experience</h3>
          </div>
          <ol class="max-w-sm list-inside list-decimal text-left text-sm sm:max-w-none sm:text-base">
            <li class="mb-4">
              <span class="font-semibold">Setup Server Info:</span>
              Click "Server Setting" button, fill in model name and API Key.
            </li>
            <li class="mb-4">
              <span class="font-semibold">Connect to Server:</span>
              Click "Connect" button to start audio conversation
            </li>
            <li>
              <span class="font-semibold">
                If you want to trial with your own private key, please register on <a href="https://platform.stepfun.com/" target="_blank" class="break-all text-blue-500">https://platform.stepfun.com/</a>
                and access your own API key in account management
              </span>
            </li>
          </ol>
        </div>
      {:else}
        <!-- AI 圆圈形象 -->
        <div class="flex flex-col items-center justify-center p-4 sm:p-8">
          <div
            class="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-tr shadow-lg transition-all duration-300 sm:h-32 sm:w-32
				{isAISpeaking ? 'from-pink-500 to-rose-500' : isRecording ? 'from-blue-500 to-rose-500' : 'from-pink-300 to-rose-400'}"
            style:transform={isAISpeaking ? 'scale(1.05)' : 'scale(1)'}
            style:animation={isAISpeaking ? 'pulse 1.5s infinite ease-in-out' : 'none'}
          >
            <span class="px-2 text-center text-sm font-medium text-white sm:text-lg">
              {#if isRecording}
                <span class="hidden sm:inline">Listening...</span>
                <span class="sm:hidden">Listening</span>
              {:else if isThinking}
                <span class="hidden sm:inline">Thinking...</span>
                <span class="sm:hidden">Thinking</span>
              {:else if isAISpeaking}
                Speaking
              {:else}
                AI
              {/if}
            </span>
          </div>
        </div>

        <!-- 对话历史 -->
        <div class="flex-1 space-y-2 overflow-y-auto p-2 sm:space-y-4 sm:p-4" use:autoScroll>
          {#each items as item}
            <div class="rounded-box flex flex-col p-2 {item.role === 'user' ? 'dark:bg-base-200 ml-auto bg-blue-100' : 'bg-base-200 mr-auto'} max-w-[90%] sm:max-w-[80%]">
              <div class="mb-2 text-sm font-semibold sm:text-base {item.role === 'user' ? 'text-blue-700 dark:text-blue-400' : 'text-rose-400'}">
                <div class="flex min-h-[1.5rem] items-center gap-2 sm:min-h-0">
                  <span class="flex-shrink-0">{item.role === 'user' ? 'You' : 'AI'}</span>
                  {#if item.formatted?.file}
                    <div class="bg-base-300/80 group flex h-6 w-36 items-center gap-1 overflow-hidden rounded-lg px-1.5 transition-all duration-200 hover:shadow sm:w-48 sm:gap-2 sm:px-2">
                      <button
                        class="flex-shrink-0 transition-colors duration-200 hover:scale-110 hover:cursor-pointer"
                        onclick={() => togglePlay(item.id)}
                        title={audioPlayers[item.id]?.isPlaying ? 'Pause' : 'Play'}
                        disabled={audioPlayers[item.id]?.isLoading || audioPlayers[item.id]?.hasError}
                      >
                        {#if audioPlayers[item.id]?.isLoading}
                          <div class="loading loading-spinner loading-xs"></div>
                        {:else if audioPlayers[item.id]?.isPlaying}
                          <Pause size={14} class="sm:h-4 sm:w-4" />
                        {:else}
                          <Play size={14} class="sm:h-4 sm:w-4" />
                        {/if}
                      </button>
                      <div id="waveform-{item.id}" class="min-w-0 flex-1 overflow-hidden rounded-lg {audioPlayers[item.id]?.hasError ? 'opacity-50' : ''}" use:initWaveSurfer={{ id: item.id, url: item.formatted.file.url }}></div>
                      <button
                        class="flex-shrink-0 opacity-0 transition-colors duration-200 group-hover:opacity-100 hover:scale-110 hover:cursor-pointer"
                        onclick={() => downloadAudio(item.formatted.file.url, `audio-${item.id}.wav`)}
                        title="Download Audio"
                      >
                        <Download size={14} class="sm:h-4 sm:w-4" />
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
              <div class="text-sm sm:text-base">
                {#if getThinkContent(item)}
                  <div class="my-1">
                    <button class="flex items-center gap-1 transition-colors hover:opacity-80" onclick={() => toggleThinkingExpansion(item.id)} style="color: rgba(120, 120, 120, 1);">
                      <span style="font-size: 12px; color: rgba(120, 120, 120, 1);">{getThinkingDisplayText(item)}</span>
                      <ChevronUp size={12} class="transition-transform duration-200 {thinkingStates[item.id]?.isExpanded ? 'rotate-0' : 'rotate-90'}" style="color: rgba(120, 120, 120, 1);" />
                    </button>
                    {#if thinkingStates[item.id]?.isExpanded !== false}
                      <div class="mt-1 flex items-start" style="position:relative;left: -15px">
                        <div class="mr-2 w-3 border-l border-gray-300"></div>
                        <div class="flex-1 border-l border-gray-300 pl-2 text-sm whitespace-pre-wrap text-gray-700">
                          {getThinkContent(item)}
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}
                {#if getTextContent(item)}
                  <p class="min-h-6 leading-relaxed">{getTextContent(item)}</p>
                {:else}
                  <div class="skeleton h-6 w-32"></div>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- 按住说话 按钮 -->
        <div class="border-base-300/50 border-t p-3 sm:p-4">
          {#if isConnected}
            {#if conversationalMode === 'manual'}
              <div class="flex justify-center">
                <button
                  onmousedown={startRecording}
                  onmouseup={stopRecording}
                  onmouseleave={isRecording ? stopRecording : null}
                  ontouchstart={startRecording}
                  ontouchend={stopRecording}
                  ontouchcancel={() => {
                    if (isRecording) stopRecording();
                  }}
                  class="flex h-20 w-20 items-center justify-center rounded-full sm:h-16 sm:w-16 {isRecording
                    ? 'bg-emerald-500'
                    : 'bg-blue-500'} touch-none text-white shadow-lg transition-colors select-none hover:opacity-90 focus:outline-none active:scale-95"
                >
                  {#if isRecording}
                    <ArrowUp size={24} class="sm:h-6 sm:w-6" />
                  {:else}
                    <Mic size={24} class="sm:h-6 sm:w-6" />
                  {/if}
                </button>
              </div>
              <div class="mt-3 text-center text-sm sm:mt-2 sm:text-sm">
                <span class="hidden sm:inline">{isRecording ? 'Release to Send' : 'Hold to Speak'}</span>
                <span class="sm:hidden">{isRecording ? 'Release to Send' : 'Tap & Hold to Speak'}</span>
              </div>
            {:else}
              <div class="flex items-center justify-center text-sm sm:text-base">Real-time conversation active...</div>
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
  <div class="modal-box w-11/12 max-w-2xl sm:w-full">
    <h2 class="mb-4 text-base font-semibold sm:text-lg">System Prompt Setting</h2>

    <textarea bind:value={newInstruction} class="border-base-300 rounded-box mb-4 h-48 w-full resize-none border p-2 text-sm sm:h-64 sm:p-3"></textarea>
    <div class="flex flex-col justify-end gap-2 sm:flex-row">
      <button onclick={() => instructionsModal.close()} class="btn rounded-box w-full sm:w-auto">Cancel</button>
      <button
        class="btn btn-primary rounded-box w-full sm:w-auto"
        onclick={() => {
          instructions = newInstruction;
          changeInstructions();
          instructionsModal.close();
        }}
      >
        Confirm
      </button>
    </div>
  </div>
</dialog>

<!-- 新增服务器设置模态框 -->
<dialog bind:this={settingsModal} class="modal">
  <div class="modal-box w-11/12 max-w-lg sm:w-full">
    <h2 class="mb-4 text-base font-semibold sm:text-lg">Server Setting</h2>
    <div class="space-y-3 sm:space-y-4">
      <label class="input rounded-box w-full">
        <span class="label w-24 text-xs sm:w-32 sm:text-sm">Request URL</span>
        <input type="text" placeholder="Request URL" bind:value={wsUrl} disabled={isConnected} class="text-sm" />
      </label>

      <label class="select rounded-box w-full">
        <span class="label w-24 text-xs sm:w-32 sm:text-sm">Model Name</span>
        <select bind:value={modelName} disabled={isConnected} class="text-sm">
          {#each availableModels as model}
            <option value={model}>{model}</option>
          {/each}
        </select>
      </label>

      {#if apiKeyType === 'private'}
        <label class="input rounded-box w-full">
          <span class="label w-24 text-xs sm:w-32 sm:text-sm">Private Key</span>
          <input type="password" placeholder="Private Key" bind:value={apiKey} disabled={isConnected} class="text-sm" />
        </label>
      {/if}
    </div>

    <div class="modal-action mt-6">
      <button onclick={() => settingsModal.close()} class="btn rounded-box w-full sm:w-auto">Confirm</button>
    </div>
  </div>
</dialog>
