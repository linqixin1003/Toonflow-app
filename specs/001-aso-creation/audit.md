# 系统审计报告：ASO 创作需求满足度

**Date**: 2026-07-08  
**Branch**: `001-aso-creation`  
**Auditor scope**: 原始需求 vs 规格/计划/任务 vs 当前代码库

---

## 1. 执行摘要

| 维度 | 结论 | 说明 |
|------|------|------|
| **代码实现** | ❌ **0%** | 无 `src/routes/aso/`、`services/aso/`、`projectType=aso` 前端 |
| **规格/计划覆盖** | ✅ **~92% MVP** | FR-001~015 有对应 US + Task；FR-013 为 P2 |
| **平台能力支撑** | ⚠️ **大部分就绪** | AI/OSS/DB 可复用；SSE、Vision 方案生成待确认 |
| **能否交付 MVP** | ⚠️ **未开始** | 需 Toonflow-app 后端 + **Toonflow-web** 前端 |
| **不影响现有功能** | ✅ **设计合规** | 增量路由 + projectType 门控，零表结构变更 |

**总评**：需求在**文档层**基本满足，**运行时代码尚未实现**；有 **4 项设计缺口**建议在 implement 前补齐。

---

## 2. 原始需求追溯矩阵

| # | 原始需求 | Spec | Plan/Tasks | 现有代码 | 状态 |
|---|---------|------|------------|----------|------|
| R1 | 项目类型增加「ASO 创作」，后续可扩展更多类型 | FR-001, FR-002, US1 | T001, T016–T021 | `addProject` 已收 `projectType` 字符串；前端仅 novel/script | 🟡 设计✅ 代码❌ |
| R2 | 输入框：文本 + 导入图片 → 生成 N 个创意方案 | FR-003~005, US2 | T022–T036 | 无 ASO 路由；`u.Ai.Text().stream()` 存在 | 🟡 设计✅ 代码❌ |
| R3 | 创意文案可编辑 | FR-006, US3 | T037–T039 | 无 | 🟡 设计✅ 代码❌ |
| R4 | 导入图片作为素材 | FR-004, US4 | T040–T045 | `saveAssets`+OSS 模式可复用 | 🟡 设计✅ 代码❌ |
| R5 | 文案 + 素材自动引用 | FR-007, US4 | `referencedAssetIds` | 无 | 🟡 设计✅ 代码❌ |
| R6 | 旁侧按钮「生成 ASO 图」 | FR-007~008, US5 | T046–T053 | `u.Ai.Image`+`multiReference` 存在 | 🟡 设计✅ 代码❌ |
| R7 | 辅助：参考图理解 → 生成 N 张新参考图 | FR-013, US7 P2 | T059–T062 | Image multiReference 可复用 | 🟠 P2 已规划 |
| R8 | 充分复用数据结构、不影响现有功能 | Constitution I/II | Phase 10 回归 | 无 ASO 污染 | ✅ 设计合规 |
| R9 | iOS/Android/通用尺寸可选，默认 1080×1920 | FR-011~012, US6 | T002, T054–T058 | `sharp.resizeImage` 存在 | 🟡 设计✅ 代码❌ |
| R10 | 方案生成优先流式 SSE | FR-010, US2 | T022–T028 | **全库无 SSE 先例** | 🟡 设计✅ 需新建 |
| R11 | projectType 沿用现有约定 | clarify C-003 | T001 | novel/script 存值模式已确认 | ✅ |
| R12 | 不支持多账号并发 | clarify-multiuser | Out of Scope | 单 admin 模型 | ✅ 已对齐决策 |

图例：✅ 满足 | 🟡 已设计未实现 | 🟠 P2/部分 | ❌ 缺口

---

## 3. 功能需求（FR）逐项审计

| FR | 要求 | 设计满足？ | 实现？ | 备注 |
|----|------|-----------|--------|------|
| FR-001 | projectType=`aso` | ✅ | ❌ | 后端 addProject 无需改 schema |
| FR-002 | 可扩展类型注册 | ✅ | ❌ | `projectTypes.ts` 已规划 |
| FR-003 | 文本输入 + 方案数 1–10 | ✅ | ❌ | 前端 InputPanel |
| FR-004 | 导入图片持久化 | ✅ | ❌ | `aso_material` + OSS |
| FR-005 | AI 生成 N 套 title+copy | ⚠️ 部分 | ❌ | **见缺口 G1：图片是否参与方案生成** |
| FR-006 | 编辑保存方案 | ✅ | ❌ | |
| FR-007 | 方案+素材 UI + 出图按钮 | ✅ | ❌ | 依赖 Toonflow-web |
| FR-008 | imageModel + multiReference | ✅ | ❌ | 供应商需支持 multiReference |
| FR-009 | 任务状态/错误原因 | ✅ | ❌ | o_tasks + o_image.errorReason |
| FR-010 | SSE 流式 + 降级 | ✅ | ❌ | 无现成 SSE，plan 已覆盖 |
| FR-011 | 12 项尺寸预设，默认竖版 | ✅ | ❌ | clarify.md 全量 |
| FR-012 | preset 字段完整 | ✅ | ❌ | asoSizePresets.ts |
| FR-013 | 参考图变体 P2 | ✅ P2 | ❌ | US7 |
| FR-014 | ASO API 校验 projectType | ✅ | ❌ | assertAsoProject |
| FR-015 | 不影响 novel/script | ✅ 设计 | N/A | 需 Phase 10 回归验证 |

---

## 4. 成功标准（SC）审计

| SC | 标准 | 当前可达？ |
|----|------|-----------|
| SC-001 | 5 分钟全流程 | ❌ 未实现 |
| SC-002 | novel/script 零回归 | ⚠️ 设计保证，**未实测** |
| SC-003 | 刷新后 100% 恢复 | ✅ 设计（o_agentWorkData JSON） |
| SC-004 | 失败可读 + 可重试 | ✅ 设计（errorReason + 重试按钮） |
| SC-005 | 第 4 种类型易扩展 | ✅ 设计（projectTypes 注册表） |

---

## 5. 现有平台能力评估

### ✅ 可直接复用

| 能力 | 代码位置 |
|------|---------|
| JWT 登录（单账号） | `src/routes/login/login.ts`, `src/app.ts` |
| 项目 CRUD | `src/routes/project/*` |
| 工作区 JSON | `o_agentWorkData`（scriptAgent 先例） |
| 素材 + 图片 | `o_assets`, `o_image`, `src/routes/assets/*` |
| 图片生成 + 参考图 | `u.Ai.Image`, `referenceList`, vendors `multiReference` |
| 图片裁缩 | `src/utils/image.ts` → `sharp` |
| 任务记录 | `src/utils/taskRecord.ts`, `o_tasks` |
| 文本流式 | `u.Ai.Text().stream()` in `src/utils/ai.ts` |
| 文件路由自动生成 | `src/core.ts` → `src/router.ts` |
| 删项目级联 | `src/routes/project/delProject.ts`（含 assets/oss） |

### ⚠️ 需新建/验证

| 能力 | 风险 |
|------|------|
| SSE HTTP 推送 | 全库无先例，Express 5 需验证 |
| ASO 前端整套 UI | **Toonflow-web 独立仓库**，本仓库 `data/web` 无源码 |
| 方案生成「看图」 | `universalAi` 文本流是否支持 image parts — **未在 plan 明确** |
| 精确像素输出 | AI 原生分辨率 ≠ 商店尺寸，依赖 sharp 后处理 — 已规划 |
| 并发出图防重复 | spec 提到，tasks **未单独任务** — 见 G3 |

### ❌ 明确不做（已对齐）

- 多账号 / userId 项目隔离
- scriptAgent / productionAgent 改造
- App Store 一键上架

---

## 6. 设计缺口（2026-07-08 已关闭）

| 缺口 | 决策 | 文档 |
|------|------|------|
| G1 Vision 识图 | ✅ 方案 A：`asoVisionAi` + base64 messages | clarify C-005, FR-005a |
| G2 前端仓库 | ✅ fork Toonflow-web → `E:\workflow\toonflow-web` | clarify C-006, T000 |
| G3 并发出图 | ✅ 409 + UI disabled | clarify C-007, T047a/T048 |
| G4 无素材出图 | ✅ 允许；素材=图片或文字描述 | clarify C-008, T040a |

**规格覆盖度**：MVP **~98%**（剩余为实现工作）

---

## 7. 不影响现有功能 — 预审计

| 检查项 | 设计 | 代码现状 | 风险 |
|--------|------|----------|------|
| novel/script API | 不修改 | 无 ASO 代码 | 低 |
| addProject schema | 仅多传 `aso` 值 | 已是 `z.string()` | 低 |
| o_assets.type 新枚举 | aso_material/aso_output | 现有 role/scene/tool | 低（仅新值） |
| router 自动生成 | 新目录 aso/ | dev 模式 hash 增量 | 低 |
| Agent Socket | ASO 不用 | 无改动 | 无 |
| 回归 | T067–T069 | **未执行** | 中（implement 后必做） |

---

## 8. 任务清单覆盖度

| User Story | Tasks | 覆盖 |
|------------|-------|------|
| US1 创建项目 | T016–T021 | ✅ |
| US2 流式方案 | T022–T036 | ✅（G1 除外） |
| US3 编辑 | T037–T039 | ✅ |
| US4 素材 | T040–T045 | ✅ |
| US5 出图 | T046–T053 | ✅（G3/G4 除外） |
| US6 尺寸 | T054–T058 | ✅ |
| US7 变体 P2 | T059–T062 | ✅ |
| Polish | T063–T072 | ✅ |

**未映射到 task 的 spec 项**：~~G1 Vision、G3 防重复~~ → 已补 T004a, T024a, T040a, T047a

---

## 9. 结论与建议

### 需求是否满足？

| 层面 | 结论 |
|------|------|
| **业务需求** | 规格 + 计划 + 72 项任务 **覆盖 MVP 主链路**；P2 变体已单列 |
| **当前系统** | **不满足** — 零 ASO 实现，用户尚不可用 |
| **架构可行性** | **满足** — 复用现有表与 AI/OSS 链路，增量风险可控 |
| **你的约束** | 单账号 ✅、不影响现有 ✅、尺寸 ✅、流式 ✅、数据复用 ✅ |

### 实施前建议（按优先级）

1. **决策 G1**：方案生成是否要「识图」→ 更新 spec + 补 task  
2. **确认 G2**：Toonflow-web 是否同步开发  
3. **决策 G4**：无素材能否出图 → 统一 acceptance  
4. **补 G3**：增加防重复提交 task  
5. **开始 implement**：T001 → …

### 审计结论

> **需求在设计和任务层已满足（~98%），代码层 0%。**  
> 四项设计缺口已关闭；可进入 `/speckit.implement`，从 **T000**（clone web）或 **T001** 开始。

---

## 10. 附录：代码库扫描证据

```text
src/routes/aso/          → 不存在
src/services/aso/        → 不存在
src/constants/projectTypes.ts → 不存在
data/skills/aso_plan_generation.md → 不存在
grep projectType=aso in src/ → 无
前端 data/web 中 basedOnAso → 无
```
