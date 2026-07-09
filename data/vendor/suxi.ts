/**

 * Toonflow AI supplier - Suxi OpenAI-compatible proxy

 * @version 1.1

 */



type VideoMode =

  | "singleImage"

  | "startEndRequired"

  | "endFrameOptional"

  | "startFrameOptional"

  | "text"

  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];



interface TextModel {

  name: string;

  modelName: string;

  type: "text";

  think: boolean;

}



interface ImageModel {

  name: string;

  modelName: string;

  type: "image";

  mode: ("text" | "singleImage" | "multiReference")[];

  associationSkills?: string;

}



interface VideoModel {

  name: string;

  modelName: string;

  type: "video";

  mode: VideoMode[];

  associationSkills?: string;

  audio: "optional" | false | true;

  durationResolutionMap: { duration: number[]; resolution: string[] }[];

}



interface TTSModel {

  name: string;

  modelName: string;

  type: "tts";

  voices: { title: string; voice: string }[];

}



interface VendorConfig {

  id: string;

  version: string;

  name: string;

  author: string;

  description?: string;

  icon?: string;

  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];

  inputValues: Record<string, string>;

  models: (TextModel | ImageModel | VideoModel | TTSModel)[];

}



type ReferenceList =

  | { type: "image"; sourceType: "base64"; base64: string }

  | { type: "audio"; sourceType: "base64"; base64: string }

  | { type: "video"; sourceType: "base64"; base64: string };



interface ImageConfig {

  prompt: string;

  referenceList?: Extract<ReferenceList, { type: "image" }>[];

  imageBase64?: string[];

  size: "1K" | "2K" | "4K";

  aspectRatio: `${number}:${number}`;

}



interface VideoConfig {

  duration: number;

  resolution: string;

  aspectRatio: "16:9" | "9:16";

  prompt: string;

  referenceList?: ReferenceList[];

  audio?: boolean;

  mode: VideoMode[];

}



interface TTSConfig {

  text: string;

  voice: string;

  speechRate: number;

  pitchRate: number;

  volume: number;

}



declare const logger: (msg: string) => void;

declare const urlToBase64: (url: string) => Promise<string>;

declare const createOpenAI: any;

declare const exports: {

  vendor: VendorConfig;

  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;

  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;

  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;

  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;

  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;

  updateVendor?: () => Promise<string>;

};



const IMAGE_REQUEST_TIMEOUT_MS = 300_000;



const vendor: VendorConfig = {

  id: "suxi",

  version: "1.1",

  author: "Toonflow",

  name: "Suxi AI",

  description: "OpenAI 兼容接口（https://new-us.suxi.ai）",

  icon: "",

  inputs: [

    { key: "apiKey", label: "API密钥", type: "password", required: true },

    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "https://new-us.suxi.ai/v1" },

  ],

  inputValues: {

    apiKey: "",

    baseUrl: "https://new-us.suxi.ai/v1",

  },

  models: [

    { name: "GPT-4o", modelName: "gpt-4o", type: "text", think: false },

    { name: "GPT Image 1", modelName: "gpt-image-1", type: "image", mode: ["text", "singleImage", "multiReference"] },

    { name: "GPT Image 2 All", modelName: "gpt-image-2-all", type: "image", mode: ["text", "singleImage", "multiReference"] },

    { name: "GPT Image 2 VIP", modelName: "gpt-image-2-vip", type: "image", mode: ["text", "singleImage", "multiReference"] },

    { name: "GPT Image 2", modelName: "gpt-image-2", type: "image", mode: ["text", "singleImage", "multiReference"] },

    { name: "DALL-E 3", modelName: "dall-e-3", type: "image", mode: ["text"] },

  ],

};



const ASPECT_RATIO_PREFIX: Record<string, string> = {

  "16:9": "横版 16:9",

  "9:16": "竖屏 9:16",

  "4:3": "4:3",

  "3:4": "3:4",

  "3:2": "3:2 尺寸",

  "2:3": "2:3 尺寸",

  "2:5": "2:5 竖屏",

  "5:2": "5:2 横屏",

  "1:1": "1:1 square composition",

};



const getHeaders = () => {

  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");

  return {

    "Content-Type": "application/json",

    Authorization: `Bearer ${vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "")}`,

  };

};



const getBaseUrl = () => vendor.inputValues.baseUrl.replace(/\/+$/, "");



const toImagePayload = (value: string) => {

  const v = (value || "").trim();

  if (/^https?:\/\//i.test(v)) return v;

  if (/^data:image\//i.test(v)) return v;

  return `data:image/png;base64,${v.replace(/^data:image\/\w+;base64,/, "")}`;

};



const normalizeImageBase64 = (value: string) => {

  const v = (value || "").trim();

  if (/^data:image\//i.test(v)) return v;

  return `data:image/png;base64,${v}`;

};



const isAdaptiveImage2 = (modelName: string) => /gpt-image-2-all/i.test(modelName);



const isSizeLockedImage2 = (modelName: string) => /gpt-image-2-vip/i.test(modelName);



const buildAdaptivePrompt = (prompt: string, aspectRatio: string) => {

  const prefix = ASPECT_RATIO_PREFIX[aspectRatio];

  if (!prefix) return prompt;

  const trimmed = (prompt || "").trim();

  if (trimmed.startsWith(prefix)) return trimmed;

  return trimmed ? `${prefix}, ${trimmed}` : prefix;

};



const extractFirstImageFromMd = (content: string) => {

  const regex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+|\/\/[^\s)]+|[^\s)]+)\)/;

  const match = content.match(regex);

  if (!match) return null;

  const raw = match[2].trim();

  const url = raw.startsWith("data:") ? raw : raw.split(/\s+/)[0];

  return { alt: match[1], url, type: url.startsWith("data:image") ? "base64" : "url" };

};



const resolveImageResult = async (urlOrBase64: string): Promise<string> => {

  if (/^data:image\//i.test(urlOrBase64)) return urlOrBase64;

  return await urlToBase64(urlOrBase64);

};



const parseImagesGenerationsResponse = async (response: any): Promise<string> => {

  if (response?.error) {

    throw new Error(`图片生成失败：${response.error.message || response.error.code}`);

  }

  const item = response?.data?.[0];

  if (item?.url) return await resolveImageResult(item.url);

  if (item?.b64_json) return normalizeImageBase64(item.b64_json);

  throw new Error("图片生成失败：未返回有效结果");

};



const parseChatImageResponse = async (response: any): Promise<string> => {

  if (response?.error) {

    throw new Error(`图片生成失败：${response.error.message || response.error.code}`);

  }

  const message = response?.choices?.[0]?.message;

  if (!message) throw new Error("图片生成失败：未返回有效结果");



  const content = message.content;

  if (typeof content === "string") {

    const imageResult = extractFirstImageFromMd(content);

    if (imageResult) return await resolveImageResult(imageResult.url);

    const trimmed = content.trim();

    if (/^https?:\/\//i.test(trimmed)) return await resolveImageResult(trimmed);

    if (/^data:image\//i.test(trimmed)) return trimmed;

  }



  if (Array.isArray(content)) {

    for (const part of content) {

      const url = part?.image_url?.url || part?.url;

      if (typeof url === "string" && url) return await resolveImageResult(url);

    }

  }



  throw new Error("图片生成失败：未能从 chat 响应中提取图片");

};



const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  if (typeof AbortController !== "undefined") {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      timer = setTimeout(() => controller.abort(), timeoutMs);
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new Error(`request timeout after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, init),
      new Promise<Response>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const postJson = async (url: string, body: any, label: string) => {

  logger(`[suxi] POST ${url} ${label}`);

  let res: Response;

  try {

    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(body),
      },
      IMAGE_REQUEST_TIMEOUT_MS,
    );

  } catch (e: any) {

    const detail = e?.cause?.message || e?.message || String(e);

    throw new Error(`图片生成网络请求失败(${label} @ ${getBaseUrl()}): ${detail}`);

  }

  const text = await res.text();

  if (!res.ok) {

    throw new Error(`图片生成请求失败: ${text}`);

  }

  try {

    return JSON.parse(text);

  } catch {

    throw new Error(`图片生成请求失败: 响应不是有效 JSON`);

  }

};



const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {

  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");

  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");

  return createOpenAI({ baseURL: getBaseUrl(), apiKey }).chat(model.modelName);

};



const imageRequestViaChat = async (config: ImageConfig, model: ImageModel, refs: string[]) => {

  const prompt = buildAdaptivePrompt(config.prompt || "", config.aspectRatio || "9:16");

  const content: any[] = refs.map((url) => ({ type: "image_url", image_url: { url } }));

  content.push({ type: "text", text: prompt });



  const response = await postJson(

    `${getBaseUrl()}/chat/completions`,

    {

      model: model.modelName,

      messages: [{ role: "user", content }],

    },

    `model=${model.modelName} chat`,

  );

  return await parseChatImageResponse(response);

};



const imageRequestViaGenerations = async (

  config: ImageConfig,

  model: ImageModel,

  options: { includeSize?: boolean; refs?: string[] },

) => {

  const baseUrl = getBaseUrl();

  const prompt = isAdaptiveImage2(model.modelName)

    ? buildAdaptivePrompt(config.prompt || "", config.aspectRatio || "9:16")

    : config.prompt || "";



  const body: any = {

    model: model.modelName,

    prompt,

    response_format: "url",

  };



  if (options.includeSize) {

    const sizeTable: Record<string, Record<string, string>> = {

      "1K": { "1:1": "1024x1024", "16:9": "1280x720", "9:16": "720x1280" },

      "2K": { "1:1": "2048x2048", "16:9": "1792x1024", "9:16": "1024x1792" },

      "4K": { "1:1": "2048x2048", "16:9": "1792x1024", "9:16": "1024x1792" },

    };

    const sizeKey = config.size || "2K";

    const ratioKey = config.aspectRatio || "9:16";

    body.size = sizeTable[sizeKey]?.[ratioKey] || "1024x1024";

    body.n = 1;

  }



  const refs = options.refs ?? [];

  if (refs.length > 0) {

    body.image = refs.length === 1 ? refs[0] : refs;

  }



  const response = await postJson(`${baseUrl}/images/generations`, body, `model=${model.modelName} images`);

  return await parseImagesGenerationsResponse(response);

};



const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {

  const refs =

    config.referenceList?.map((r) => toImagePayload(r.base64)) ??

    config.imageBase64?.map(toImagePayload) ??

    [];



  if (isAdaptiveImage2(model.modelName)) {

    if (refs.length > 0) {

      return await imageRequestViaChat(config, model, refs);

    }

    return await imageRequestViaGenerations(config, model, { includeSize: false });

  }



  if (isSizeLockedImage2(model.modelName)) {

    return await imageRequestViaGenerations(config, model, { includeSize: true, refs });

  }



  return await imageRequestViaGenerations(config, model, { includeSize: true, refs });

};



const videoRequest = async (_config: VideoConfig, _model: VideoModel): Promise<string> => {

  return "";

};



const ttsRequest = async (_config: TTSConfig, _model: TTSModel): Promise<string> => {

  return "";

};



const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {

  return { hasUpdate: false, latestVersion: "1.1", notice: "" };

};



const updateVendor = async (): Promise<string> => {

  return "";

};



exports.vendor = vendor;

exports.textRequest = textRequest;

exports.imageRequest = imageRequest;

exports.videoRequest = videoRequest;

exports.ttsRequest = ttsRequest;

exports.checkForUpdates = checkForUpdates;

exports.updateVendor = updateVendor;



export {};


