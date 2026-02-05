# 🔧 DeepSeek 图像不渲染问题诊断和解决方案

## 问题诊断

### 根本原因：类型映射不匹配

**问题**：使用 DeepSeek 模型时，JSON 能够正确解析，但图像不渲染。

**根本原因**：
1. **类型值不匹配** - DeepSeek 返回的元素类型使用大写名称，如 `"type": "ROAD"`
2. **系统类型已映射** - 但 `types.ts` 中定义的枚举值是映射后的，如 `ROAD = 'driving_lane'`
3. **样式查找失败** - MapRenderer 中的 `ELEMENT_STYLES` 使用映射后的值，导致找不到对应的样式
4. **渲染管道中断** - 无法找到样式导致元素无法正确渲染

### 数据流问题示意

```
DeepSeek API Response
    ↓
{ "type": "ROAD", ... }  ← 原始类型名称（大写）
    ↓
responseParser.ts 解析成功
    ↓
MapRenderer 接收到 layout
    ↓
ELEMENT_STYLES["ROAD"]  ← 查找失败！（因为映射值是 "driving_lane"）
    ↓
❌ 元素无样式 → 无法渲染
```

## 解决方案

### 修复：类型规范化函数

在 `services/responseParser.ts` 中添加了：

```typescript
/**
 * 类型映射：将 AI 返回的类型名称映射到系统类型枚举值
 */
const TYPE_MAPPING: Record<string, string> = {
  'ROAD': 'driving_lane',
  'SIDEWALK': 'pedestrian_path',
  'RAMP': 'slope',
  'SPEED_BUMP': 'deceleration_zone',
  'LANE_LINE': 'ground_line',
  // ... 其他映射
};

/**
 * 将 AI 返回的布局数据中的类型转换为系统类型
 */
export const normalizeLayoutElementTypes = (layout: any): any => {
  return {
    ...layout,
    elements: layout.elements.map((element: any) => ({
      ...element,
      type: TYPE_MAPPING[element.type] || element.type,
    })),
  };
};
```

### 修复后的数据流

```
DeepSeek API Response
    ↓
{ "type": "ROAD", ... }
    ↓
responseParser.ts 解析
    ↓
normalizeLayoutElementTypes() 转换
    ↓
{ "type": "driving_lane", ... }  ← 映射后的类型
    ↓
MapRenderer 接收到 layout
    ↓
ELEMENT_STYLES["driving_lane"]  ← ✅ 找到！
    ↓
✅ 应用样式 → 成功渲染
```

## 支持的类型转换表

| AI 返回的类型 | 系统类型 | 含义 |
|---|---|---|
| ROAD / road | driving_lane | 驾驶通道 |
| SIDEWALK / sidewalk | pedestrian_path | 人行道 |
| RAMP / ramp | slope | 斜坡 |
| SPEED_BUMP / speed_bump | deceleration_zone | 减速带 |
| LANE_LINE / lane_line | ground_line | 地面线 |
| 其他类型 | 保持原值 | 其他类型保持不变 |

## 验证修复

修复后，使用 DeepSeek 模型时应该能看到：

✅ **日志显示**：
```
[deepseek] 解析成功
[deepseek] 类型转换完成
```

✅ **右侧编辑区显示彩色的停车场布局图像**：
- 蓝色 = 停车位
- 深灰色 = 驾驶通道
- 绿色 = 入口
- 红色 = 出口
- 其他颜色 = 其他设施

✅ **"System Diagnostics"显示 "Valid"**（无约束违反）

## 为什么其他模型可能没有这个问题

- **Gemini**：系统 Prompt 中明确指定了映射后的类型名称，所以返回的就是正确的类型值
- **OpenAI (GPT)**：GPT 模型在 systemPrompt 中也被指定了正确的类型名称

## 技术细节

### 为什么需要类型映射？

在 `types.ts` 中，枚举值被重新映射的原因是为了：
1. **UI 标签更清晰**：`pedestrian_path` 比 `SIDEWALK` 更易理解
2. **数据库兼容性**：使用蛇形命名法便于存储
3. **国际化支持**：类型名称独立于显示标签

### 位置映射示例

```typescript
// types.ts 中的定义
export enum ElementType {
  ROAD = 'driving_lane',        // "ROAD" 被映射到 "driving_lane"
  SIDEWALK = 'pedestrian_path', // "SIDEWALK" 被映射到 "pedestrian_path"
}

// MapRenderer.tsx 中的样式使用
const ELEMENT_STYLES: Record<string, { fill: string; opacity: number }> = {
  [ElementType.ROAD]: { fill: '#1e293b', opacity: 1 },      // 使用映射值 "driving_lane"
  [ElementType.SIDEWALK]: { fill: '#1e293b', opacity: 1 },  // 使用映射值 "pedestrian_path"
};

// 现在 responseParser 自动转换
normalizeLayoutElementTypes(layout)  // "ROAD" → "driving_lane"
```

## 故障排查

### 如果仍然看不到图像

1. **检查浏览器控制台**（F12 → Console）
   - 查找红色错误信息
   - 检查 d3.js 相关错误

2. **检查日志中的警告**
   ```
   [deepseek] 警告: 数据结构可能不完整
   ```
   - 说明 JSON 解析成功但数据不完整
   - 检查 elements 数组是否为空

3. **验证 API Key**
   - 确保 `.env.local` 中设置了正确的 `VITE_DEEPSEEK_API_KEY`
   - DeepSeek 的 API Key 通常以 `sk-` 开头

4. **尝试 Gemini 模型**
   - 如果 Gemini 能显示图像，说明 MapRenderer 没问题
   - 说明问题在 DeepSeek 的特定响应格式

## 相关文件

- [responseParser.ts](./services/responseParser.ts) - 类型映射实现
- [types.ts](./types.ts) - 元素类型定义
- [MapRenderer.tsx](./components/MapRenderer.tsx) - 渲染逻辑
- [deepseekService.ts](./services/deepseekService.ts) - DeepSeek API 集成

---

**修复日期**：2026年1月29日  
**状态**：✅ 已解决 - 类型转换映射已实现
