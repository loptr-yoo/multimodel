## 项目概述

本项目采用**多模型适配 (Multi-Model Adapter)** + **双阶段生成 (Two-Stage Generation)** 架构，支持楼层平面图和停车场布局的 AI 生成。系统根据场景类型自动调整生成策略，确保高效且准确的布局输出。

## 核心架构

- **服务层 (Services)**: 包括业务编排核心 `parkingFlow.ts`、模型抽象层 `llmProvider.ts` 和响应解析器 `responseParser.ts`。
- **场景注册 (Scene Registry)**: 通过 `sceneRegistry.ts` 配置不同场景的 Prompt 规则、渲染样式和后处理算法。
- **几何算法 (Geometry)**: 提供通用几何工具 `aiCommonUtils.ts` 和楼层专用算法 `floorGeometryUtils.ts`。

## 核心方法

- `executeGeneration`: 生成入口，执行"生成 -> 校验 -> 自动修复"循环。
- `executeRefinement`: 细化入口，基于已有布局进行增量生成。
- `runIterativeFix`: 自动修复循环，针对违规项调用 AI 微调。
- `validateLayout`: 约束校验器，输出重叠、越界等错误列表。

## 注册新场景

在 `utils/sceneRegistry.ts` 中添加新的 `SceneDefinition` 对象，定义 Prompt 配置、样式和后处理算法，然后加入 `SCENE_REGISTRY` 字典。
```typescript
export const MyNewScene: SceneDefinition = {
  id: 'my_new_scene',
  promptConfig: {
    roleDefinition: '场景角色定义',
    geometricRules: '核心几何约束规则',
    requiredElements: ['必须包含的元素类型'],
    exampleJSON: 'Few-Shot 示例'
  },
  styles: { ... }, // 定义元素颜色与透明度
  postProcessAlgorithms: [ ... ] // 挂载专用后处理算法
};
```


## 运行指南

**Prerequisites:** Node.js

1. 安装依赖: `npm install`
2. 在 [.env.local](.env.local) 中设置 `GEMINI_API_KEY`
3. 运行应用: `npm run dev`
