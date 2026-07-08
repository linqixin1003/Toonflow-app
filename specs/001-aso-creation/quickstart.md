# Quickstart: ASO 创作开发

**Branch**: `001-aso-creation`

---

## 1. 环境

### Toonflow-app（后端）

```bash
cd E:\workflow\toonflow
yarn install
yarn dev   # http://localhost:10588
```

### Toonflow-web（前端 — 用户 fork）

```bash
git clone https://github.com/linqixin1003/Toonflow-web.git E:\workflow\toonflow-web
cd E:\workflow\toonflow-web
git checkout -b 001-aso-creation
yarn install
yarn dev   # 指向 localhost:10588 API
```

构建并回拷：

```bash
cd E:\workflow\toonflow-web
yarn build
# 复制 dist 到 E:\workflow\toonflow\data\web\
```

登录：`admin` / `admin123`

**Vision 模型**：设置中心配置 `asoVisionAi`（ASO 图片理解），选用支持 image input 的模型（如 GPT-4o、Gemini Vision）。

---

## 2. 开发顺序（推荐）

0. **Phase 0**：clone Toonflow-web → `E:\workflow\toonflow-web`（T000）
1. 常量与服务层（无 UI）
2. ASO API 路由（含 Vision planGenerator、409 防重复）
3. curl / Postman 验通主链路
4. Toonflow-web 前端页面
5. 构建前端 dist → 复制到 `data/web`

---

## 3. 创建 ASO 测试项目

```bash
curl -X POST http://localhost:10588/api/project/addProject \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "projectType": "aso",
    "name": "ASO测试",
    "intro": "健身 App",
    "type": "工具",
    "artStyle": "写实",
    "directorManual": "",
    "videoRatio": "16:9",
    "imageModel": "1:your-image-model",
    "videoModel": "",
    "imageQuality": "2K",
    "mode": "standard"
  }'
```

---

## 4. 验证工作区

```bash
curl -X POST http://localhost:10588/api/aso/getWorkspace \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"projectId": YOUR_ID}'
```

---

## 5. SSE 流式方案（浏览器/Node）

```javascript
const res = await fetch('/api/aso/generatePlans/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ...' },
  body: JSON.stringify({ projectId, inputText: '...', planCount: 3, assetIds: [] }),
});
const reader = res.body.getReader();
// 解析 SSE 帧...
```

---

## 6. 关键文件一览

| 文件 | 职责 |
|------|------|
| `src/constants/projectTypes.ts` | 类型注册 |
| `src/constants/asoSizePresets.ts` | 12 项尺寸 |
| `src/services/aso/workspace.ts` | 读写 asoWorkspace |
| `src/services/aso/planGenerator.ts` | AI 方案 + SSE |
| `src/services/aso/imageGenerator.ts` | 出图 + sharp |
| `src/routes/aso/*.ts` | HTTP 入口 |
| `data/skills/aso_plan_generation.md` | 方案生成提示词 |

---

## 7. 回归检查

升级后确认：
- [ ] 创建 `novel` 项目仍进入小说流程
- [ ] 创建 `script` 项目仍进入剧本流程
- [ ] 现有 `/api/novel/*`、`/api/script/*` 无 404/行为变化
