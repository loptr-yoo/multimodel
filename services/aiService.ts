/**
 * services/aiService.ts
 * AI 服务入口 (重构版)
 */

import { BuildingData, ParkingLayout, SceneDefinition } from '../types';
import { AIProvider, getApiKeyEnvKey } from '../utils/aiConfig';
import { BuildingScene, DEFAULT_SCENE_ID, SCENE_REGISTRY } from '../utils/sceneRegistry';
import { CORE_ARCHITECT_PROMPT, MASTER_PLANNER_PROMPT } from '../utils/buildingPrompts';
import { createLLMClient } from './llmProvider';
import { callLLMWithRetry, executeFloorGenerationWithCore, executeGeneration, executeRefinement } from './parkingFlow';
import { parseAIResponse } from './responseParser';
import { mapToInternalLayout } from './aiCommonUtils';

export interface AIServiceOptions {
  provider: AIProvider;
  model: string;
  apiKey: string;
}

const getActiveScene = (sceneId?: string): SceneDefinition => {
  const key = sceneId || DEFAULT_SCENE_ID;
  return SCENE_REGISTRY[key] || SCENE_REGISTRY[DEFAULT_SCENE_ID];
};

// 内存缓存：缓存热点场景生成结果，提升 QPS，降低延迟
const generationCache = new Map<string, { data: BuildingData; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 小时缓存

const getCacheKey = (prompt: string, model: string, sceneId?: string) => {
  return `${prompt.trim().toLowerCase()}|${model}|${sceneId || DEFAULT_SCENE_ID}`;
};

/**
 * 生成布局入口
 */
export const generateLayout = async (
  prompt: string,
  options: AIServiceOptions,
  onProgress?: (msg: string) => void,
  sceneId?: string
): Promise<ParkingLayout> => {
  const { provider, model, apiKey } = options;

  if (!apiKey) {
    throw new Error(`No API Key configured for ${provider}. Please check your .env or settings.`);
  }

  // 1. 创建统一客户端
  const client = createLLMClient(provider);

  // 2. 执行统一生成流程
  return await executeGeneration(prompt, client, apiKey, model, onProgress, sceneId);
};

export const generateBuilding = async (
  prompt: string,
  options: AIServiceOptions,
  onProgress?: (msg: string) => void,
  sceneId?: string
): Promise<BuildingData> => {
  const { provider, model, apiKey } = options;
  if (!apiKey) {
    throw new Error(`No API Key configured for ${provider}. Please check your .env or settings.`);
  }

  const client = createLLMClient(provider);
  const scene = getActiveScene(sceneId);

  // 检查缓存
  const cacheKey = getCacheKey(prompt, model, sceneId);
  const cached = generationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    onProgress?.('命中热点场景缓存，极速返回结果...');
    // 延迟一点以模拟网络请求，防止 UI 闪烁
    await new Promise(resolve => setTimeout(resolve, 500));
    return JSON.parse(JSON.stringify(cached.data)); // 返回深拷贝防止污染
  }

  try {
    if (scene.id !== BuildingScene.id) {
      const layout = await executeGeneration(prompt, client, apiKey, model, onProgress, sceneId);
      const floorId = scene.id === DEFAULT_SCENE_ID ? 'B1' : '1F';
      const layoutWithScene = { ...layout, sceneId: scene.id };
      const singleData = {
        blueprint: [],
        floors: { [floorId]: layoutWithScene }
      };
      generationCache.set(cacheKey, { data: singleData, timestamp: Date.now() });
      return singleData;
    }

    onProgress?.('正在规划楼层结构...');
    const plannerText = await callLLMWithRetry(client, [
      { role: 'user', content: MASTER_PLANNER_PROMPT(prompt) }
    ], { apiKey, model, temperature: 0.2, maxTokens: 2048 }, onProgress);
    const plannerParsed = parseAIResponse(plannerText, { provider: client.providerName as any, model });
    const floorsRaw = Array.isArray(plannerParsed?.floors) ? plannerParsed.floors : [];
    const floors = floorsRaw
      .map((f: any, idx: number) => ({
        id: String(f?.id || `floor_${idx + 1}`),
        name: String(f?.name || `${idx + 1}F`),
        sceneId: String(f?.id === 'B1' ? DEFAULT_SCENE_ID : (f?.sceneId || 'building_floor_plan')),
        description: f?.description ? String(f.description) : ''
      }))
      .slice(0, 10);

    if (floors.length === 0) {
      floors.push({ id: 'B1', name: 'B1', sceneId: DEFAULT_SCENE_ID, description: 'Underground parking' });
      floors.push({ id: '1F', name: '1F', sceneId: 'building_floor_plan', description: '' });
    }
    if (!floors.some(f => f.id === 'B1')) {
      floors.unshift({ id: 'B1', name: 'B1', sceneId: DEFAULT_SCENE_ID, description: 'Underground parking' });
    }

    onProgress?.('正在设计核心筒基础图纸...');
    const coreText = await callLLMWithRetry(client, [
      { role: 'user', content: CORE_ARCHITECT_PROMPT(prompt, getActiveScene('building_floor_plan')) }
    ], { apiKey, model, temperature: 0.3, maxTokens: 4096 }, onProgress);
    const coreParsed = parseAIResponse(coreText, { provider: client.providerName as any, model });
    const coreElementsRaw = Array.isArray(coreParsed?.elements) ? coreParsed.elements : [];
    const coreLayout = mapToInternalLayout({ width: 800, height: 600, elements: coreElementsRaw });
    const coreBlueprint = coreLayout.elements;

    const floorLayouts: Record<string, ParkingLayout> = {};
    for (const floor of floors) {
      onProgress?.(`正在生成楼层: ${floor.name}...`);
      onProgress?.(`楼层场景: ${floor.sceneId}`);
      const floorPrompt = [prompt, floor.description].filter(Boolean).join(' / ');
      const generated = await executeFloorGenerationWithCore(
        floorPrompt,
        coreBlueprint,
        client,
        apiKey,
        model,
        onProgress,
        floor.sceneId
      );
      floorLayouts[floor.id] = { ...generated, sceneId: floor.sceneId };
    }

    const finalData = {
      blueprint: coreBlueprint,
      floors: floorLayouts
    };

    generationCache.set(cacheKey, { data: finalData, timestamp: Date.now() });

    return finalData;
  } catch (e: any) {
    onProgress?.(`❌ 生成楼宇失败: ${e?.message || String(e)}`);
    throw e;
  }
};

/**
 * 细化布局入口
 */
export const augmentLayoutWithRoads = async (
  layout: ParkingLayout,
  options: AIServiceOptions,
  onProgress?: (msg: string) => void,
  sceneId?: string
): Promise<ParkingLayout> => {
  const { provider, model, apiKey } = options;

  if (!apiKey) {
    throw new Error(`No API Key configured for ${provider}.`);
  }

  // 1. 创建统一客户端
  const client = createLLMClient(provider);

  // 2. 执行统一细化流程
  return await executeRefinement(layout, client, apiKey, model, onProgress, sceneId);
};

// --- 辅助函数保持不变 ---

export const getApiKeyFromEnv = (provider: AIProvider): string => {
  const key = getApiKeyEnvKey(provider);
  // @ts-ignore
  return import.meta.env[key] || '';
};

export const checkAvailableProviders = (): AIProvider[] => {
  const providers: AIProvider[] = [];
  if (getApiKeyFromEnv('gemini')) providers.push('gemini');
  if (getApiKeyFromEnv('deepseek')) providers.push('deepseek');
  if (getApiKeyFromEnv('openai')) providers.push('openai');
  return providers;
};

// 添加一个别名函数以保持向后兼容性
export const augmentLayout = augmentLayoutWithRoads;
