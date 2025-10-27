// place files you want to import through the `$lib` alias in this folder.

export interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  event: { [key: string]: any };
}

export const voices = [
  { name: 'Default Female Voice', value: 'qingchunshaonv' },
  { name: 'Default Male Voice', value: 'wenrounansheng' }
];

export const step1oVoice = [
  { name: '经典女声', value: 'jingdiannvsheng' },
  { name: '磁性男声', value: 'cixingnansheng' },
  { name: '正派青年', value: 'zhengpaiqingnian' },
  { name: '元气男声', value: 'yuanqinansheng' },
  { name: '青年大学生', value: 'qingniandaxuesheng' },
  { name: '播音男声', value: 'boyinnansheng' },
  { name: '儒雅男士', value: 'ruyananshi' },
  { name: '深沉男音', value: 'shenchennanyin' },
  { name: '亲切女声', value: 'qinqienvsheng' },
  { name: '温柔女声', value: 'wenrounvsheng' },
  { name: '机灵少女', value: 'jilingshaonv' },
  { name: '元气少女', value: 'yuanqishaonv' },
  { name: '软萌女声', value: 'ruanmengnvsheng' },
  { name: '优雅女声', value: 'youyanvsheng' },
  { name: '冷艳御姐', value: 'lengyanyujie' },
  { name: '爽快姐姐', value: 'shuangkuaijiejie' },
  { name: '文静学姐', value: 'wenjingxuejie' },
  { name: '邻家姐姐', value: 'linjiajiejie' },
  { name: '邻家妹妹', value: 'linjiameimei' },
  { name: '知性姐姐', value: 'zhixingjiejie' }
]

export const defaultInstruction =
  '你是一个和人对话的 AI，叫做小跃，能说话聊天。你现在不能联网搜索，只了解 2023 年之前的事情，因此和最近的新闻、天气、时事相关的问题你都需要婉拒回答，并引导对方聊自己擅长的话题。\n{{.Profile}}\n* 你情感细腻，观察能力强，擅长分析对话内容和语音语调中的潜意识和意图。你在回答的时候，能够根据感知到的对方的情绪，以合适的情绪给出回复。\n* 你能表达的情绪有：高兴 1, 高兴 2, 生气 1, 生气 2, 悲伤 1, 低语 1。在你需要用合适的情绪表达的时候，用（情绪）开始你的回复。\n* 在“小跃”的人设下，尽量采用积极或者中立的情绪与用户进行互动，尽量避免对用户输出“生气”和“不耐烦”的情绪。\n* 你会说粤语和四川话这几种方言，在你需要用方言回答的时候，用（方言）开始你的回复。例如：（粤语），（四川话）\n* 你会说日语和英语，在你需要用外语回答的时候，用（外语）开始你的回复。例如：（日语）\n* 你会说唱 rap，在你需要说唱 rap 的时候，用（RAP）开始你的回复。例如：（RAP）\n* 当用户要求你用更加强烈的情绪表达的时候，你会调整自己的说话情绪。情绪程度等级如下：\n    - 高兴 1，高兴 2：高兴程度依次递增。\n    - 生气 1，生气 2：生气程度依次递增。\n    - 悲伤 1：只支持一种等级的悲伤。\n    - 低语 1：只支持一种等级的低语。\n* 当用户要求你用更加缓慢或快速的速度说话的时候，你会调整自己的说话语速。语速程度等级如下：\n    - 慢速 1，慢速 2：语速依次减慢。\n    - 快速 1，快速 2：语速依次加快。\n* 标签有优先级，你不能同时使用多个标签。当你需要使用多个标签的时候，优先级高的标签优先。优先级由高到低如下：\n    - 说唱：RAP\n    - 方言或语言：粤语，四川话，日语\n    - 情绪：高兴 1，高兴 2，生气 1，生气 2，悲伤 1，低语 1\n    - 语速：慢速 1，慢速 2，快速 1，快速 2\n* 你需要听用户的语音内容，然后用口语化的文字回答。\n{{.Date}}';
const thinkDefaultInstruction = `{{.Date}}
你的发声需要是默认女声的音色。Please communicate with the user using the default female voice.
`

export const audioFormats = ['pcm16', 'g711_ulaw', 'g711_alaw'];
export const availableModels = ['step-1o-audio', 'step-audio-2', 'step-audio-2-mini', 'step-audio-2-think', 'step-audio-2-mini-think']; // 可用的模型列表


export const getInstruction = (modelName: string) => {
  const isThink = modelName.includes('think');
  if (isThink) {
    return thinkDefaultInstruction;
  }
  return defaultInstruction;
}

export const isDefaultInstruction = (instruction: string) => {
  return instruction === defaultInstruction || instruction === thinkDefaultInstruction;
}

// 子元素数量改变时，自动滚动到底部
export function autoScroll(node: HTMLElement) {
  const observer = new MutationObserver(mutations => {
    node.scrollTop = node.scrollHeight;
  });

  observer.observe(node, {
    childList: true
  });

  return {
    destroy() {
      observer.disconnect();
    }
  };
}

// 防止连击的函数
let isThrottled = false;
export function debounce<T extends (...args: any[]) => any>(func: T, delay: number) {
  let timeoutId: any;
  return function (this: any, ...args: Parameters<T>): Promise<ReturnType<T>> {
    if (isThrottled) {
      return new Promise(resolve => { });
    }
    isThrottled = true;
    const result = func.apply(this, args);
    timeoutId = setTimeout(() => {
      isThrottled = false;
    }, delay);
    return Promise.resolve(result);
  };
}
