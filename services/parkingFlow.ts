/**
 * services/parkingFlow.ts
 * 核心业务逻辑：生成、解析、修复、增强
 * 适用于所有 LLM Provider
 */

import { ParkingLayout, ConstraintViolation } from '../types';
import { PROMPTS } from '../utils/prompts';
import { safeParseResponse, normalizeLayoutElementTypes } from './responseParser';
import { validateLayout } from '../utils/geometry';
import { LLMClient, LLMConfig } from './llmProvider';
import {
  mapToInternalLayout,
  postProcessLayout,
  mergeLayoutElements,
  enhanceLayoutWithGeometry,
  calculateScore,
  sleep
} from './aiCommonUtils';

// --- 配置常量 ---
const MAX_RETRIES = 3;
const MAX_FIX_PASSES = 4;

/**
 * 带有重试机制的 LLM 调用
 */
const callLLMWithRetry = async (
  client: LLMClient, 
  messages: any[], 
  config: LLMConfig, 
  onLog?: (msg: string) => void
): Promise<string> => {
  let lastError: Error | null = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      if (i > 0) {
        onLog?.(`⏳ [${client.providerName}] 请求重试 ${i}/${MAX_RETRIES}...`);
        await sleep(1000 * i); // 指数退避
      }
      return await client.chat(messages, config);
    } catch (e: any) {
      lastError = e;
      onLog?.(`⚠️ [${client.providerName}] 调用失败: ${e.message}`);
    }
  }
  throw lastError || new Error("Max retries exceeded");
};

/**
 * 统一的自动修复循环 (Fix Loop)
 */
const runIterativeFix = async (
  layout: ParkingLayout,
  client: LLMClient,
  config: LLMConfig,
  onLog?: (msg: string) => void
): Promise<ParkingLayout> => {
  let currentLayout = layout;
  let lastScore = Infinity;

  for (let pass = 1; pass <= MAX_FIX_PASSES; pass++) {
    const violations = validateLayout(currentLayout);
    const score = calculateScore(violations);

    if (score === 0) {
      onLog?.(`✅ [Fix Loop] 布局完美 (Pass ${pass}, Score 0)`);
      break;
    }
    
    // 如果分数没有改善且不是第一轮，提前退出（防止死循环）
    if (score >= lastScore && pass > 1) {
      onLog?.(`🛑 [Fix Loop] 优化停滞 (Score ${score}), 停止修复`);
      break;
    }

    onLog?.(`🔧 [Fix Loop] 修复轮次 ${pass}/${MAX_FIX_PASSES} (Score: ${score}, Violations: ${violations.length})`);
    lastScore = score;

    // 简化输入以节省 Token
    const simplifiedInput = currentLayout.elements.map(e => ({
      id: e.id, t: e.type, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height), r: e.rotation
    }));

    try {
      // 使用低温度进行修复
      const fixResponse = await callLLMWithRetry(client, [
        { role: 'system', content: PROMPTS.systemPrompt() },
        { role: 'user', content: PROMPTS.fix(simplifiedInput as any, violations) }
      ], { ...config, temperature: 0.2 }, onLog);

      const parsed = await safeParseResponse(fixResponse, { provider: client.providerName as any, model: config.model }, onLog);
      
      // 输出 AI 的修复策略日志
      if (parsed.fix_strategy && onLog) {
        (Array.isArray(parsed.fix_strategy) ? parsed.fix_strategy : [parsed.fix_strategy])
          .forEach((s: string) => onLog(`🤖 策略: ${s}`));
      }

      const normalized = normalizeLayoutElementTypes(parsed);
      const fixedLayout = mapToInternalLayout(normalized);

      // 合并修复结果
      currentLayout = {
        ...currentLayout,
        elements: mergeLayoutElements(currentLayout.elements, fixedLayout.elements)
      };

    } catch (e: any) {
      onLog?.(`⚠️ 修复步骤失败: ${e.message}`);
    }
  }

  return currentLayout;
};

/**
 * 主入口：统一生成流程
 */
export const executeGeneration = async (
  prompt: string,
  client: LLMClient,
  apiKey: string,
  model: string,
  onLog?: (msg: string) => void
): Promise<ParkingLayout> => {
  const config: LLMConfig = { apiKey, model, temperature: 0.7 };

  onLog?.(`🚀 [${client.providerName}] 开始生成...`);

  // 1. 初始生成
  const responseText = await callLLMWithRetry(client, [
    { role: 'system', content: PROMPTS.systemPrompt() },
    { role: 'user', content: PROMPTS.generation(prompt) }
  ], config, onLog);

  // 2. 解析
  const rawData = await safeParseResponse(responseText, { provider: client.providerName as any, model }, onLog);
  if (rawData.reasoning_plan && onLog) onLog(`🧠 推理计划: ${rawData.reasoning_plan}`);

  let layout = mapToInternalLayout(rawData);
  onLog?.(`生成的初始元素数量: ${layout.elements.length}`);

  // 3. 自动修复循环
  layout = await runIterativeFix(layout, client, config, onLog);

  // 4. 几何增强 (填充车位、清理路口、标线等)
  layout = await enhanceLayoutWithGeometry(layout, onLog);

  return postProcessLayout(layout);
};

/**
 * 主入口：统一细化/增强流程 (Augment)
 */
export const executeRefinement = async (
  currentLayout: ParkingLayout,
  client: LLMClient,
  apiKey: string,
  model: string,
  onLog?: (msg: string) => void
): Promise<ParkingLayout> => {
  const config: LLMConfig = { apiKey, model, temperature: 0.4 }; // 细化使用稍低温度

  onLog?.(`✨ [${client.providerName}] 开始细化布局...`);

  // 输入瘦身
  const simplified = currentLayout.elements.map(e => ({
    id: e.id, t: e.type, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height)
  }));

  // 1. 调用 AI 获取新元素
  const responseText = await callLLMWithRetry(client, [
    { role: 'system', content: PROMPTS.systemPrompt() },
    { role: 'user', content: PROMPTS.refinement({ elements: simplified }, currentLayout.width, currentLayout.height) }
  ], config, onLog);

  const rawData = await safeParseResponse(responseText, { provider: client.providerName as any, model }, onLog);
  if (rawData.reasoning_plan && onLog) onLog(`✨ 细化思路: ${rawData.reasoning_plan}`);

  const aiGeneratedLayout = mapToInternalLayout(rawData);
  
  // 2. 合并新老元素 (简单的追加模式，后续通过 Fix 和 Geometry 整理)
  let layout: ParkingLayout = {
    width: currentLayout.width,
    height: currentLayout.height,
    elements: [...currentLayout.elements, ...aiGeneratedLayout.elements]
  };

  // 3. 先执行几何增强 (确保新生成的路和车位规整)
  layout = await enhanceLayoutWithGeometry(layout, onLog);

  // 4. 再执行修复循环 (解决合并可能产生的冲突)
  layout = await runIterativeFix(layout, client, config, onLog);

  return postProcessLayout(layout);
};