# Changelog

## [Unreleased]

### Fixed (review)

- 统一 `nextEntityId` 避免 assets/workspace ID 碰撞
- 出图/变体生成锁与 HTTP 409 竞态保护
- Vision 未配置时降级为纯文本方案生成（`visionFallback` 提示）
- 方案数量解析不足时明确报错；素材 ID 校验；上传 10MB 上限

### Added

- **ASO 创作**项目类型（`projectType=aso`）：创意方案生成、ASO 出图、素材管理
- ASO API：`/api/aso/*`（workspace、方案流式/同步生成、素材 CRUD、出图、轮询、尺寸预设）
- `asoVisionAi` Agent 部署槽（Vision 多模态方案生成）
- ASO 尺寸预设（iOS / Android / 通用）
- 参考图变体生成（P2）：`POST /api/aso/generateRefVariants`，任务分类 `ASO参考图变体`
- 同一 `planId` 出图进行中时返回 HTTP 409

### Changed

- `router.ts` 自动注册 ASO 路由
- 现有 `novel` / `script` 流程不受影响；删除项目时级联清理 ASO 数据及 OSS `/{projectId}/aso/`
