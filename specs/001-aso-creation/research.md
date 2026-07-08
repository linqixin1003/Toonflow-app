# Research: ASO 创作

**Date**: 2026-07-08  
**Branch**: `001-aso-creation`

---

## R-001 — projectType 现有约定

**结论**：前端 bundle 已确认 DB 存 `novel` / `script`，展示走 i18n。

- 组件：`<t-option value="novel">` / `value="script"`
- i18n：`workbench.project.dialog.basedOnNovel` / `basedOnScript`
- 后端 `addProject.ts` 仅 `z.string()`，无枚举校验
- **ASO 新增**：`value="aso"` + `basedOnAso` i18n 键

---

## R-002 — 工作区 JSON 复用 o_agentWorkData

**结论**：与 `scriptAgent` 的 `getPlanData` / `setPlanData` 模式一致。

- 现有：`key='scriptAgent'`，`data` JSON + 关联 `o_script`
- ASO：`key='asoWorkspace'`，`data` 自包含 plans/outputs/settings
- 优点：零 migration；`delProject` 已删 `o_agentWorkData where projectId`

---

## R-003 — 素材/成品复用 o_assets + o_image

**结论**：扩展 `type` 枚举即可，不修改表结构。

| type | 用途 |
|------|------|
| `role`/`scene`/`tool` | 现有短剧资产 |
| `aso_material` | ASO 导入/变体参考图 |
| `aso_output` | ASO 成品图 |

OSS 路径：`/{projectId}/aso/material/`、`/{projectId}/aso/output/`

`delProject` 已通过 `projectId` 删全部 assets，**无需改删项目逻辑**（aso 类型走同路径）。

---

## R-004 — SSE 流式方案生成

**结论**：代码库**尚无 SSE 先例**，需新建；`u.Ai.Text().stream()` 已存在。

**实现选型**：

```typescript
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.flushHeaders();
// event: plan_delta\ndata: {...}\n\n
```

**注意**：
- Express 5 + JWT 中间件需确保 stream 路由不被 JSON parser 干扰
- 客户端断开时 `req.on('close')` 中止 AI stream
- 降级：`generatePlans.ts` 调用 `invoke()` 一次性返回相同 `plans[]` 结构

**AI 输出格式**：要求模型输出 JSON 数组或 XML 块 `<plan index="1"><title/><copy/></plan>`，流式解析器增量提取字段推 SSE。

---

## R-005 — 图片生成与尺寸

**结论**：复用 `generateAssets.ts` 同步模式 + `sharp.resizeImage` 后处理。

流程：
1. `u.Ai.Image(project.imageModel).run({ aspectRatio, size, referenceList })`
2. 保存临时文件 → `resizeImage` 至 preset width×height
3. 写入 OSS + 更新 `o_image.resolution` 为 `"1080x1920"` 字符串

**aspectRatio 映射**（gcd 简化）：

| 预设 | aspectRatio |
|------|-------------|
| 1080×1920 | `9:16` |
| 1920×1080 | `16:9` |
| 1080×1080 | `1:1` |
| 1024×500 | `512:250` → 简化为最接近 vendor 支持比 |

**sizeTier**：宽或高 max 边 ≤1080 → `1K`；≤2048 → `2K`；否则 `4K`

---

## R-006 — 任务与轮询

**结论**：图片生成采用「先返回 taskId/imageId，前端轮询」。

- 插入 `o_image.state='生成中'`
- 后台 async IIFE 执行生成（或同步等待如 generateAssets — MVP 可同步，超时风险用 task 记录）
- 新增 `POST /api/aso/pollingOutputs` 仿 `pollingImageAssets`

---

## R-007 — 前端仓库边界（C-006 已确认）

**结论**：UI 在用户 fork 的 **Toonflow-web**（`E:\workflow\toonflow-web`）；本仓库后端 + build 回拷 `data/web`。

前端需新增：
- 项目创建下拉第三项
- 项目详情路由 `projectType === 'aso'` → `AsoWorkbench.vue`
- SSE 消费 fetch readable stream
- MaterialGrid 支持图片 + 文字素材

**Setup**：Phase 0 T000 clone Toonflow-web。

---

## R-007a — Vision 方案生成（C-005）

**结论**：新增 `o_agentDeploy.key='asoVisionAi'`；含图片素材时多模态 stream。

- `planGenerator.loadVisionImages(assetIds)` 从 OSS 读 base64
- `planGenerator.buildVisionMessages()` → Vercel AI SDK image parts
- 未配置 Vision → 降级 describe 文本 + `universalAi`

---

## R-007b — 素材与出图（C-008）

**结论**：`aso_material.materialKind` = `image` | `text`；出图不强制素材。

---

## R-007c — 并发出图（C-007）

**结论**：同 planId 进行中 → HTTP 409；前端 disable 按钮。

---

## R-008 — 不新增 DB 表的理由

| 需求 | 为何现有表足够 |
|------|----------------|
| 创意方案 | JSON in o_agentWorkData |
| 素材 | o_assets |
| 成品历史 | o_assets(aso_output) + outputs[] 索引 |
| 任务 | o_tasks |
| 尺寸预设 | 后端常量，非持久化实体 |

---

## R-009 — 风险与缓解

| 风险 | 缓解 |
|------|------|
| SSE 与 Electron 代理 | 开发阶段用 fetch stream；生产验证 CORS/缓冲 |
| 模型不支持 multiReference | UI 提示；降级纯文生图 |
| sharp 放大低分辨率 AI 图 | 优先选 2K/4K sizeTier；文档说明 |
| 前端闭源联调慢 | **T000** clone Toonflow-web 到本地 fork |
| 未配置 asoVisionAi | 降级 universalAi + UI 提示 |
