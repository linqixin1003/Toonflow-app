# Clarify Resolution: ASO 创作

**Date**: 2026-07-08  
**Status**: Resolved

---

## C-001 — ASO 图尺寸 ✅ 已确认

**决策**：v1 支持**可选尺寸预设**，用户出图前可选择；默认 **竖版主图 1080×1920**。

### 尺寸预设清单

#### iOS（App Store Connect）

| 预设 ID | 名称 | 宽×高 | 用途 |
|---------|------|-------|------|
| `ios_preview_9_16` | App 预览 9:16 | 1080×1920 | 预览视频封面/预览图（竖版） |
| `ios_preview_16_9` | App 预览 16:9 | 1920×1080 | 预览视频封面/预览图（横版） |
| `ios_screenshot_67` | iPhone 6.7" 截图 | 1290×2796 | 截图 |
| `ios_screenshot_65` | iPhone 6.5" 截图 | 1242×2688 | 截图 |
| `ios_screenshot_55` | iPhone 5.5" 截图 | 1242×2208 | 截图 |
| `ios_screenshot_ipad_129` | iPad 12.9" 截图 | 2048×2732 | 截图 |

#### Android（Google Play）

| 预设 ID | 名称 | 宽×高 | 用途 |
|---------|------|-------|------|
| `android_feature_graphic` | Feature Graphic | 1024×500 | 特色图 |
| `android_icon` | App Icon | 512×512 | 高分辨率图标 |
| `android_screenshot_9_16` | 截图 9:16 | 1080×1920 | 常用竖版截图 |

#### 通用推广素材

| 预设 ID | 名称 | 宽×高 | 用途 | 默认 |
|---------|------|-------|------|------|
| `general_vertical_1080x1920` | 竖版主图 | 1080×1920 | 投放/素材沉淀 | **✅ 默认** |
| `general_square_1080` | 方图 | 1080×1080 | 投放/素材沉淀 | |
| `general_horizontal_1920x1080` | 横版 | 1920×1080 | 投放/素材沉淀 | |

**实现映射**：预设 → `{ width, height, aspectRatio, sizeTier }`，调用 `u.Ai.Image` 时传入对应 `aspectRatio` 与分辨率档位（复用现有 `1K/2K/4K` + `aspectRatio` 机制；必要时出图后用 `sharp` 精确裁缩至目标像素）。

---

## C-002 — 方案生成流式 ✅ 已确认

**决策**：**优先流式**；若联调成本过高，可降级为非流式，但不改变 API 契约形状。

| 层级 | 方案 |
|------|------|
| **首选** | `POST /api/aso/generatePlans/stream`，SSE 推送方案片段（逐字/逐段） |
| **降级** | 同路径或 `/generatePlans` 一次性 JSON 返回，前端模拟打字效果 |
| **技术栈** | 复用 `u.Ai(...).stream()`（`src/utils/ai.ts` 已有 `streamText`） |
| **持久化** | 流结束后写入 `o_agentWorkData.plans[]`；中断时可保存 partial |

图片生成（ASO 图、参考图变体）保持**异步任务 + 轮询**（与现有 `generateAssets` 一致），不做流式。

---

## C-003 — projectType 约定 ✅ 已确认

**决策**：**沿用现有项目技术栈**，与 `novel` / `script` 完全一致。

| 存储值（DB/API） | 展示文案（i18n） | 说明 |
|-----------------|-----------------|------|
| `novel` | 基于小说原文 | 现有 |
| `script` | 基于剧本 | 现有 |
| `aso` | ASO 创作 | **新增** |

- 前端：`t-option value="aso"` + `$t('workbench.project.dialog.basedOnAso')`
- 后端：`z.enum(['novel','script','aso'])` 或继续 `z.string()` + 白名单校验
- 路由隔离：`project.projectType === 'aso'`
- **不迁移**现有 `novel`/`script` 数据

---

## C-004 — AI 模型配置 ✅ 已更新（见 C-005）

- 创意方案（纯文本）：`universalAi`（文本）
- 创意方案（含参考图）：`asoVisionAi`（图片理解 / Vision 模型）
- ASO 图 / 参考图变体：项目 `imageModel`
- v1 新增 `asoVisionAi` 部署槽位（见 C-005）

---

## C-005 — 方案生成 Vision 识图 ✅ 已确认（2026-07-08）

**决策**：**方案 A** — Vision 模型 + 图片 base64 注入 messages。

| 场景 | 模型槽位 | 调用方式 |
|------|---------|---------|
| 仅文本输入 | `universalAi` | `u.Ai.Text().stream()` 纯文本 messages |
| 含导入图片 | `asoVisionAi` | 同上，user message 含 `image` parts（base64）+ 文本 prompt |
| 未配置 Vision | 降级 | 仅用素材 `name`/`describe` 文本拼接 + `universalAi`，UI 提示「未配置图片理解模型」 |

**实现要点**：

1. `o_agentDeploy` 新增 key=`asoVisionAi`，名称「ASO 图片理解」
2. `planGenerator.loadVisionImages(assetIds)` 从 OSS 读 base64
3. `planGenerator.buildVisionMessages()` 构造 Vercel AI SDK 多模态 messages
4. 设置中心可配置 Vision 模型（须为支持 image input 的 text 模型，如 GPT-4o / Gemini Vision）

---

## C-006 — 前端仓库 ✅ 已确认（2026-07-08）

**决策**：将 **Toonflow-web** fork/clone 到用户自有仓库，与 Toonflow-app 并列开发。

| 项 | 值 |
|----|-----|
| 后端 | `E:\workflow\toonflow`（Toonflow-app fork） |
| 前端 | `E:\workflow\toonflow-web`（Toonflow-web fork，待 clone） |
| 构建 | `yarn build` → 复制 dist 到 Toonflow-app `data/web/` |
| MVP | **必须**完成前端 fork，否则无法 UI 交付 |

**Setup 任务**：T000 clone Toonflow-web 并创建 `001-aso-creation` 分支。

---

## C-007 — 并发出图防重复 ✅ 已确认（2026-07-08）

**决策**：同一 `planId` 存在 `state='生成中'` 的 output 时，**拒绝重复提交**。

| 层 | 行为 |
|----|------|
| 后端 | `POST /aso/generateAsoImage` → **HTTP 409**，message=`该方案正在生成中，请稍候` |
| 前端 | 按钮 disabled + loading；轮询完成后恢复 |
| 判定 | `workspace.outputs` 或 `o_image` 中 `planId` + `state='生成中'` |

---

## C-008 — 素材类型与无素材出图 ✅ 已确认（2026-07-08）

**决策**：素材 = **图片** 或 **文字描述**；出图**不强制**素材。

| 素材形态 | 存储 | 方案生成 | ASO 出图 |
|---------|------|---------|---------|
| 图片素材 | `aso_material` + `o_image` | Vision base64 注入 | `referenceList` 参考图 |
| 文字素材 | `aso_material`，无 `o_image`，`describe` 存文案 | 文本拼入 prompt | 拼入 image prompt |
| 无素材 | — | 仅 `inputText` | 纯文案文生图（与 generateAssets 一致） |

**统一规则**：

- 方案生成校验：`inputText.trim()` **或** 任意素材（图/文）**或** `assetIds` 非空
- 出图校验：仅需有效 `planId`；`assetIds` 可选，默认 `referencedAssetIds`
- 移除 US5「至少一张素材」硬性要求
