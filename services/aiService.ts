/**
 * services/aiService.ts
 * AI 服务入口 (重构版)
 */

import { ParkingLayout } from '../types';
import { AIProvider, getApiKeyEnvKey } from '../utils/aiConfig';
import { createLLMClient } from './llmProvider';
import { executeGeneration, executeRefinement } from './parkingFlow';

export interface AIServiceOptions {
  provider: AIProvider;
  model: string;
  apiKey: string;
}

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
