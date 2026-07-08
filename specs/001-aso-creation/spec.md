# Feature Specification: ASO 创作项目类型

**Feature Branch**: `001-aso-creation`

**Created**: 2026-07-08

**Status**: Clarified (Draft → Ready for Plan)

**Input**: 在 Toonflow 中新增项目类型「ASO 创作」，支持文本+图片输入生成可编辑创意方案，并基于方案与素材生成 ASO 图；需充分复用现有数据结构且不影响现有功能。

---

## 背景与目标

### 业务背景

ASO（App Store Optimization）场景需要：根据产品描述与参考视觉，快速产出多套商店展示创意文案，并生成对应 ASO 宣传图。当前 Toonflow 仅支持「基于小说原文」「基于剧本」两条短剧生产链路，缺少面向 ASO 的轻量工作流。

### 目标

1. 在「项目类型」下拉中新增 **ASO 创作**（并为后续更多类型预留扩展机制）
2. ASO 项目提供独立工作区：输入 → 多方案生成 → 编辑 → 绑定素材 → 生成 ASO 图
3. **零影响**现有 novel/script 项目的功能与数据

### 非目标（Out of Scope — v1）

- 不改造 scriptAgent / productionAgent 决策链
- 不引入小说/剧本/分镜/视频模块
- 不做 App Store 一键上架或尺寸模板批量导出（可后续迭代）
- 不在本 spec 中定义具体 AI 模型或供应商选型

---

## User Scenarios & Testing

### User Story 1 — 创建 ASO 项目 (Priority: P1)

作为运营人员，我希望在新建项目时选择「ASO 创作」，以便进入 ASO 专用工作流而非短剧流程。

**Why this priority**: 项目类型是一切的入口，没有它后续功能无法隔离。

**Independent Test**: 创建 `projectType='aso'` 的项目后，进入项目只看到 ASO 工作区，不出现小说/剧本导航。

**Acceptance Scenarios**:

1. **Given** 用户在新建项目弹窗，**When** 打开「项目类型」下拉，**Then** 可见「基于小说原文」「基于剧本」「ASO 创作」三项
2. **Given** 用户选择 ASO 创作并填写必填项，**When** 提交创建，**Then** 项目保存成功且 `o_project.projectType = 'aso'`（与现有 `novel`/`script` 存值方式一致）
3. **Given** 已有 novel/script 项目，**When** 系统升级后，**Then** 这些项目行为与数据完全不变

---

### User Story 2 — 输入需求并生成创意方案 (Priority: P1)

作为运营人员，我希望在输入框中填写文本、导入参考图片，并指定生成方案数量，以便 AI 产出多套可对比的创意文案。

**Why this priority**: 核心主功能起点。

**Independent Test**: 仅调用 ASO 生成方案 API，传入文本+图片+数量，返回 N 条结构化方案且持久化。

**Acceptance Scenarios**:

1. **Given** ASO 项目工作区，**When** 用户输入描述文本并设置方案数为 3，**Then** 系统生成 3 套创意方案（含标题+正文）
2. **Given** 用户同时导入 2 张图片，**When** 生成方案，**Then** 图片入库为项目素材，Vision 模型通过 base64 理解图片内容并影响方案输出
3. **Given** 文本为空且无图片，**When** 点击生成，**Then** 提示至少提供文本或图片之一，不发起 AI 调用
4. **Given** 方案生成中，**When** 用户刷新页面，**Then** 已生成方案仍可从服务端恢复
5. **Given** 用户点击生成方案，**When** AI 开始输出，**Then** 文案以流式方式逐段展示（SSE）；流式不可用时降级为一次性返回

---

### User Story 3 — 编辑创意文案 (Priority: P1)

作为运营人员，我希望直接编辑 AI 生成的创意文案，以便微调后再用于出图。

**Why this priority**: 文案可编辑是 ASO 工作流的关键人工环节。

**Independent Test**: 修改某方案 `copy` 字段并保存，再次加载内容一致。

**Acceptance Scenarios**:

1. **Given** 已生成方案列表，**When** 用户编辑某方案正文并保存，**Then** 服务端持久化且 `edited=true`
2. **Given** 用户编辑后，**When** 再次生成 ASO 图，**Then** 使用最新编辑后的文案

---

### User Story 4 — 素材管理与自动引用 (Priority: P1)

作为运营人员，我希望导入的图片或文字描述自动成为项目素材，并在选定方案旁展示已关联素材，以便方案生成与出图时自动带入。

**Why this priority**: 素材是 Vision 方案生成与 ASO 出图的可选增强输入。

**Independent Test**: 上传图片或添加文字素材后在 `o_assets` 可查到，工作区展示素材列表，出图请求可携带 assetId 列表或为空。

**Acceptance Scenarios**:

1. **Given** 用户导入图片，**When** 上传完成，**Then** 创建 `o_assets`（type=`aso_material`）及对应 `o_image` 记录
2. **Given** 用户添加文字描述素材，**When** 保存完成，**Then** 创建 `o_assets`（type=`aso_material`，`materialKind='text'`，无 `o_image`，`describe` 存文案）
3. **Given** 工作区存在素材，**When** 用户选中某创意方案，**Then** UI 展示「文案 + 已引用素材（图/文）」组合视图
4. **Given** 方案未手动取消引用，**When** 生成 ASO 图，**Then** 默认引用用户勾选的全部 `aso_material`；图片走 referenceList，文字拼入 prompt

---

### User Story 5 — 生成 ASO 图 (Priority: P1)

作为运营人员，我希望在「创意文案 + 素材（可选）」旁点击「生成 ASO 图」，以便得到可用于商店的宣传图。

**Why this priority**: 主功能闭环终点。

**Independent Test**: 选定方案调用生成接口（素材可选），返回图片写入 OSS 并在 UI 展示。

**Acceptance Scenarios**:

1. **Given** 已选方案（可无素材），**When** 点击「生成 ASO 图」，**Then** 异步生成并在完成后展示结果图（纯文案文生图或与图片/文字素材组合）
2. **Given** 该方案已有进行中的出图任务，**When** 再次点击「生成 ASO 图」，**Then** 后端返回 409，前端按钮保持 disabled
3. **Given** 生成失败，**When** 任务结束，**Then** 展示失败原因且可重试
4. **Given** 同一方案多次生成（无并发冲突），**When** 查看历史，**Then** 保留多个 ASO 输出版本（关联 `o_image`）
5. **Given** 用户未改尺寸，**When** 生成 ASO 图，**Then** 默认输出 **1080×1920** 竖版主图
6. **Given** 用户打开尺寸选择器，**When** 选择 iOS/Android/通用预设之一，**Then** 按所选宽×高出图

---

### User Story 6 — 选择 ASO 出图尺寸 (Priority: P1)

作为运营人员，我希望在生成 ASO 图前选择目标平台尺寸预设，以便直接得到符合商店规范的素材。

**Why this priority**: 尺寸是 ASO 交付物的硬约束，与出图主功能同等重要。

**Independent Test**: 切换预设后调用出图 API，`o_image.resolution` 或 output 元数据与预设一致。

**Acceptance Scenarios**:

1. **Given** ASO 工作区，**When** 用户打开尺寸下拉，**Then** 可见 iOS / Android / 通用三类预设（见 Clarify 文档）
2. **Given** 未手动选择，**When** 首次出图，**Then** 使用默认 `general_vertical_1080x1920`（1080×1920）
3. **Given** 用户选择 `ios_screenshot_65`（1242×2688），**When** 生成完成，**Then** 成品像素尺寸为 1242×2688（必要时 sharp 后处理）

---

### User Story 7 — 参考图变体生成 (Priority: P2)

作为运营人员，我希望基于文案和参考图，让 AI 理解参考图风格并生成指定数量的新参考图，以便扩充素材库。

**Why this priority**: 辅助功能，提升素材多样性，但不阻塞主链路 MVP。

**Independent Test**: 传入 1 张参考图 + 文案 + 数量 N，返回 N 张新图并入库为 `aso_material`。

**Acceptance Scenarios**:

1. **Given** 选定参考图与描述文案，**When** 设置生成数量为 4 并执行，**Then** 产出 4 张新参考图加入素材库
2. **Given** 变体生成中，**When** 用户离开页面，**Then** 任务继续执行且完成后可查看结果

---

### User Story 8 — ~~多用户隔离~~（已取消，Out of Scope）

> 决策：不实现多账号；与原版 Toonflow 相同，单账号共享所有项目。

---

### Edge Cases

- 方案数设为 1~10 范围外 → 校验拒绝
- 图片格式不支持 / 超大文件 → 沿用现有上传校验与错误提示
- AI 供应商未配置图像模型 → 引导用户至设置中心
- 并发生成 ASO 图 → 任务队列或 `o_tasks` 状态防重复提交
- 删除项目 → 级联清理 ASO 工作区数据、素材、图片（复用 `delProject` 扩展）

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 支持项目类型值 `aso`（与现有 `novel`/`script` 同约定），展示名「ASO 创作」
- **FR-002**: 系统 MUST 提供可扩展的项目类型注册机制，新增类型无需改动 novel/script 逻辑
- **FR-003**: ASO 项目 MUST 提供文本输入框，支持多行描述与可选方案数量（默认 1，范围 1~10）
- **FR-004**: ASO 项目 MUST 支持导入图片或文字描述并持久化为项目素材（`aso_material`）
- **FR-005**: 系统 MUST 基于文本+素材上下文调用 AI 生成 N 套创意方案；含图片时 MUST 使用 Vision 模型（`asoVisionAi`）注入 base64 多模态 messages
- **FR-005a**: 系统 MUST 在 `o_agentDeploy` 提供 `asoVisionAi`（ASO 图片理解）配置槽位
- **FR-006**: 用户 MUST 能编辑并保存任意方案的文案内容
- **FR-007**: 工作区 MUST 展示「选定方案 + 自动引用素材」组合，并提供「生成 ASO 图」操作
- **FR-008**: ASO 图生成 MUST 使用项目配置的 `imageModel`；有图片素材时支持参考图（multiReference）；无素材时纯文案文生图
- **FR-008a**: 同一 `planId` 存在进行中的出图任务时，MUST 拒绝重复提交（HTTP 409）
- **FR-009**: 系统 MUST 记录生成任务状态（生成中/成功/失败）及错误原因
- **FR-010**: 创意方案生成 MUST 优先采用流式输出（SSE）；实现复杂时可降级为非流式，API 响应结构保持一致
- **FR-011**: ASO 出图 MUST 支持可选尺寸预设（iOS / Android / 通用），默认 `1080×1920` 竖版主图
- **FR-012**: 每个尺寸预设 MUST 包含 `presetId`、`label`、`width`、`height`、`platform`、`category`
- **FR-013**: （P2）系统 MUST 支持基于文案+参考图批量生成指定数量的新参考图
- **FR-014**: 所有 ASO API MUST 校验 `projectType === 'aso'`，防止误操作其他类型项目
- **FR-015**: 现有 novel/script 项目的 API、页面、Agent MUST 不受 ASO 功能影响
- ~~FR-016~020 多用户~~：**Out of Scope**，不实施

### Key Entities（映射现有数据结构）

| 概念 | 存储方案 | 说明 |
|------|---------|------|
| 项目类型 | `o_project.projectType` | 新增 `'aso'`；现有 `'novel'`/`'script'` 不变 |
| 出图尺寸预设 | `o_agentWorkData.data.outputSizePreset` | 默认 `general_vertical_1080x1920` |
| ASO 工作区 | `o_agentWorkData` | `key='asoWorkspace'`，`data` 为 JSON（见下） |
| 导入素材 | `o_assets` | `type='aso_material'`，`materialKind='image'|'text'`，`projectId` 关联 |
| 素材图片 | `o_image` | 关联 `assetsId`，文件存 `data/oss/{projectId}/aso/` |
| ASO 成品图 | `o_assets` + `o_image` | `type='aso_output'`，`remark` 存 `planId` |
| 生成任务 | `o_tasks` | `taskClass='ASO方案生成'` / `'ASO图生成'` / `'ASO参考图变体'` |

#### `o_agentWorkData.data` JSON 结构（asoWorkspace）

```json
{
  "inputText": "产品描述...",
  "planCount": 1,
  "plans": [
    {
      "id": "plan_1700000001",
      "title": "方案一标题",
      "copy": "创意正文...",
      "edited": false,
      "createdAt": 1700000001000,
      "updatedAt": 1700000001000
    }
  ],
  "selectedPlanId": "plan_1700000001",
  "referencedAssetIds": [101, 102],
  "outputSizePreset": "general_vertical_1080x1920",
  "outputs": [
    {
      "planId": "plan_1700000001",
      "imageId": 501,
      "assetId": 201,
      "presetId": "general_vertical_1080x1920",
      "width": 1080,
      "height": 1920,
      "createdAt": 1700000002000
    }
  ]
}
```

> **设计说明**：不新建业务表，工作区状态集中在一个 JSON 文档；素材与成品仍走成熟的 assets/image 链路，便于复用 OSS、缩略图、任务系统。

### 与现有类型的字段复用

创建 ASO 项目时，复用 `o_project` 现有字段：

| 字段 | ASO 项目用法 |
|------|-------------|
| `name` | 项目名称 |
| `intro` | 项目简介 / App 一句话描述 |
| `imageModel` | ASO 图生成模型 |
| `imageQuality` | 出图质量档位（1K/2K/4K，与尺寸预设配合） |
| `artStyle` | 可选，映射视觉风格提示 |
| `type` | 可映射 App 品类标签 |
| `videoModel` / `videoRatio` / `directorManual` | 创建时可传空或默认值，UI 隐藏 |
| `mode` | 保留，默认 `'standard'` |

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 用户可在 5 分钟内完成「创建 ASO 项目 → 输入 → 生成 3 方案 → 编辑 → 出图」全流程
- **SC-002**: 现有 novel/script 项目回归用例 100% 通过（零行为变更）
- **SC-003**: ASO 方案与成品在页面刷新后 100% 可恢复
- **SC-004**: ASO 图生成失败时，100% 展示可读错误信息并支持重试
- **SC-005**: 新增第 4 种项目类型时，仅需注册表 + 工作区模块，无需修改 ASO/novel/script 核心逻辑

---

## Assumptions

- 用户已在设置中心配置文本模型、**Vision 模型（asoVisionAi）**与图像模型（复用现有供应商系统）
- 前端在用户 fork 的 **Toonflow-web**（`E:\workflow\toonflow-web`）实施，build 后复制至 Toonflow-app `data/web/`
- `projectType` 沿用现有约定：DB 存 `novel` / `script` / `aso`，展示走 i18n（与现有下拉一致）
- 创意方案生成优先 SSE 流式；图片生成仍为异步任务模式
- v1 不实现方案版本历史树，仅保留最新编辑内容 + 多次出图历史
- 「自动引用」默认引用用户勾选的全部 `aso_material`（含图片与文字描述）；出图不强制素材
- 素材形态：图片（有 `o_image`）或纯文字描述（仅 `describe`）；方案生成对图片走 Vision，对文字走 prompt 拼接
- **账号模型**：单账号（admin），与原版一致；不做多用户隔离（见 [clarify-multiuser.md](./clarify-multiuser.md)）

---

## 架构方案摘要（供 `/speckit.plan` 使用）

### 模块划分

```
src/routes/aso/
├── getWorkspace.ts         # 读取 asoWorkspace
├── saveWorkspace.ts        # 保存输入/选中方案/引用关系/尺寸预设
├── uploadMaterial.ts       # 导入图片 → o_assets + o_image
├── createTextMaterial.ts   # 文字描述素材 → o_assets（无 o_image）
├── listMaterials.ts        # 素材列表
├── getSizePresets.ts       # 返回尺寸预设清单
├── generatePlansStream.ts  # SSE 流式生成方案（首选）
├── generatePlans.ts          # 非流式降级入口
├── updatePlan.ts           # 编辑单条方案文案
├── generateAsoImage.ts       # 主功能：方案+素材+尺寸 → ASO 图
└── generateRefVariants.ts   # P2：参考图变体
```

### 项目类型注册（沿用现有模式）

```typescript
// src/constants/projectTypes.ts
export const PROJECT_TYPES = {
  novel: {
    value: 'novel',
    labelKey: 'workbench.project.dialog.basedOnNovel',
    modules: ['novel', 'scriptAgent', 'production'],
  },
  script: {
    value: 'script',
    labelKey: 'workbench.project.dialog.basedOnScript',
    modules: ['script', 'scriptAgent', 'production'],
  },
  aso: {
    value: 'aso',
    labelKey: 'workbench.project.dialog.basedOnAso',
    modules: ['aso'],
  },
} as const;
```

### ASO 尺寸预设（后端常量，完整列表见 clarify.md）

```typescript
// src/constants/asoSizePresets.ts — 默认项
{ id: 'general_vertical_1080x1920', width: 1080, height: 1920, default: true }
```

### 隔离策略

| 层级 | 策略 |
|------|------|
| 路由 | ASO 路由内校验 `projectType` |
| 前端 | 按 `projectType` 动态路由，ASO 不挂载 novel/script 组件 |
| Agent | ASO 不注册新 Socket 命名空间；直接用 REST + `u.Ai.*` |
| 删除 | 扩展 `delProject` 清理 `aso_material`/`aso_output` 资产 |

### AI 调用策略

| 场景 | 调用 | 提示词来源 |
|------|------|-----------|
| 创意方案（纯文本，流式） | `u.Ai.Text('universalAi').stream()` + SSE | `aso_plan_generation.md` |
| 创意方案（含图片，流式） | `u.Ai.Text('asoVisionAi').stream()` + 多模态 messages | skill + 图片 base64 |
| 创意方案（降级） | 同上 invoke 非流式 | 同上 |
| ASO 图 | `u.Ai.Image(imageModel)` + 可选参考图 + 尺寸预设 | 方案 copy + 文字素材 + preset |
| 参考图变体 | `u.Ai.Image` multiReference | 文案 + 原图 |

### 流式方案生成（SSE 事件）

| 事件 |  payload | 说明 |
|------|----------|------|
| `plan_start` | `{ index, total }` | 开始第 N 套方案 |
| `plan_delta` | `{ index, field, delta }` | 标题/正文增量 |
| `plan_done` | `{ index, plan }` | 单套方案完成 |
| `all_done` | `{ plans }` | 全部完成并持久化 |
| `error` | `{ message }` | 失败 |

---

## 澄清结论

详见 [`clarify.md`](./clarify.md) — C-001~C-008 均已确认。

---

## 下一步（Spec Kit 流程）

1. ~~`/speckit.clarify`~~ ✅ 已完成
2. ~~`/speckit.plan`~~ ✅ 已完成
3. ~~`/speckit.tasks`~~ ✅ 已完成 → [tasks.md](./tasks.md)
4. **`/speckit.implement`** — 从 T001 开始执行
