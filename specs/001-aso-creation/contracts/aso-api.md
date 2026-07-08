# ASO API Contract

**Base URL**: `http://localhost:10588/api`  
**Auth**: JWT Header（与现有接口一致，白名单外均需登录）  
**Response 包装**: `{ code, data, message }` — 成功用 `success()`，失败用 `error()`

**通用前置校验**（除 getSizePresets）：
1. JWT 有效（全局中间件，单账号 admin）
2. `projectId` 存在且 `o_project.projectType === 'aso'`

---

## 1. GET /aso/getSizePresets

返回全部 ASO 出图尺寸预设（无需 projectId）。

### Response `data`

```json
{
  "presets": [
    {
      "id": "general_vertical_1080x1920",
      "label": "竖版主图",
      "width": 1080,
      "height": 1920,
      "platform": "general",
      "category": "promo",
      "aspectRatio": "9:16",
      "default": true
    }
  ],
  "grouped": {
    "ios": ["ios_preview_9_16", "..."],
    "android": ["android_feature_graphic", "..."],
    "general": ["general_vertical_1080x1920", "..."]
  }
}
```

---

## 2. POST /aso/getWorkspace

### Request

```json
{ "projectId": 1234567890 }
```

### Response `data`

完整 `AsoWorkspace` JSON（见 data-model.md）+ 素材摘要：

```json
{
  "workspace": { "...": "AsoWorkspace" },
  "materials": [
    { "id": 101, "name": "ref1.png", "filePath": "/oss/...", "imageId": 501 }
  ]
}
```

---

## 3. POST /aso/saveWorkspace

部分更新工作区（merge patch）。

### Request

```json
{
  "projectId": 1234567890,
  "patch": {
    "inputText": "一款健身 App...",
    "planCount": 3,
    "selectedPlanId": "plan_1700000001",
    "referencedAssetIds": [101, 102],
    "outputSizePreset": "ios_screenshot_65"
  }
}
```

### Response

```json
{ "message": "保存成功", "workspace": { "...": "merged AsoWorkspace" } }
```

---

## 4. POST /aso/uploadMaterial

导入**图片**素材。

### Request

```json
{
  "projectId": 1234567890,
  "name": "竞品截图",
  "base64": "data:image/png;base64,...",
  "describe": "可选描述"
}
```

### Response `data`

```json
{
  "assetId": 101,
  "imageId": 501,
  "materialKind": "image",
  "filePath": "/oss/1234567890/aso/material/uuid.png"
}
```

**副作用**：若 `referencedAssetIds` 为空，自动 append 新 assetId。

---

## 4b. POST /aso/createTextMaterial

导入**文字描述**素材（无图片文件）。

### Request

```json
{
  "projectId": 1234567890,
  "name": "品牌调性",
  "describe": "年轻活力、蓝白主色、强调 AI 私教"
}
```

校验：`describe.trim()` 非空。

### Response `data`

```json
{
  "assetId": 102,
  "materialKind": "text",
  "name": "品牌调性",
  "describe": "年轻活力、蓝白主色、强调 AI 私教"
}
```

**副作用**：自动 append 到 `referencedAssetIds`（若为空）。

---

## 5. POST /aso/listMaterials

### Request

```json
{
  "projectId": 1234567890,
  "type": "aso_material"
}
```

`type` 可选，默认 `aso_material`；传 `aso_output` 列出成品。

### Response `data`

```json
[
  {
    "id": 101,
    "name": "ref1",
    "type": "aso_material",
    "materialKind": "image",
    "imageId": 501,
    "filePath": "...",
    "state": "已完成"
  },
  {
    "id": 102,
    "name": "品牌调性",
    "type": "aso_material",
    "materialKind": "text",
    "describe": "年轻活力...",
    "imageId": null,
    "filePath": null
  }
]
```

---

## 6. POST /aso/deleteMaterial

### Request

```json
{ "projectId": 1234567890, "assetId": 101 }
```

从 workspace.referencedAssetIds 移除并删除 DB + OSS。

---

## 7. POST /aso/generatePlans/stream （SSE — 首选）

### Request

```json
{
  "projectId": 1234567890,
  "inputText": "健身 App，主打 AI 私教",
  "planCount": 3,
  "assetIds": [101, 102]
}
```

校验：`inputText.trim()` 或 `assetIds.length > 0` 或工作区存在文字素材。

**Vision 行为**：`assetIds` 中含图片素材时，后端使用 `asoVisionAi` 模型，将图片 base64 注入多模态 messages；纯文本/文字素材时使用 `universalAi`。

### Response

`Content-Type: text/event-stream`

```
event: plan_start
data: {"index":0,"total":3}

event: plan_delta
data: {"index":0,"field":"title","delta":"活力"}

event: plan_delta
data: {"index":0,"field":"copy","delta":"开启"}

event: plan_done
data: {"index":0,"plan":{"id":"plan_...","title":"...","copy":"...","edited":false,...}}

event: all_done
data: {"plans":[...],"workspace":{...}}

event: error
data: {"message":"模型未配置"}
```

---

## 8. POST /aso/generatePlans （非流式降级）

Request 同 §7。

### Response `data`

```json
{
  "plans": [ { "id", "title", "copy", "edited", "createdAt", "updatedAt" } ],
  "workspace": { "...": "AsoWorkspace" }
}
```

---

## 9. POST /aso/updatePlan

### Request

```json
{
  "projectId": 1234567890,
  "planId": "plan_1700000001",
  "title": "可选更新标题",
  "copy": "编辑后的创意正文..."
}
```

### Response

```json
{ "plan": { "...": "updated AsoPlan" } }
```

---

## 10. POST /aso/generateAsoImage

### Request

```json
{
  "projectId": 1234567890,
  "planId": "plan_1700000001",
  "presetId": "general_vertical_1080x1920",
  "assetIds": [101, 102]
}
```

`assetIds` 可选，默认 workspace.referencedAssetIds（可为空 → 纯文案出图）。

**并发校验**：若该 `planId` 已有 `state='生成中'` 的 output，返回 **409**：

```json
{ "code": 409, "message": "该方案正在生成中，请稍候" }
```

### Response `data`（立即返回，异步生成）

```json
{
  "outputAssetId": 201,
  "imageId": 601,
  "state": "生成中",
  "presetId": "general_vertical_1080x1920",
  "width": 1080,
  "height": 1920
}
```

---

## 11. POST /aso/pollingOutputs

### Request

```json
{
  "projectId": 1234567890,
  "imageIds": [601, 602]
}
```

### Response `data`

```json
[
  {
    "imageId": 601,
    "assetId": 201,
    "state": "已完成",
    "filePath": "/oss/...",
    "errorReason": null,
    "width": 1080,
    "height": 1920
  }
]
```

返回所有请求的 `imageIds` 对应记录（含 `生成中` / `已完成` / `生成失败`），供前端轮询刷新。

---

## 12. POST /aso/generateRefVariants （P2）

### Request

```json
{
  "projectId": 1234567890,
  "sourceAssetId": 101,
  "copy": "参考此图风格，生成健身 App 场景",
  "count": 4
}
```

### Response `data`

```json
{
  "taskIds": [601, 602, 603, 604],
  "assetIds": [201, 202, 203, 204]
}
```

---

## 错误码约定

| HTTP | 场景 |
|------|------|
| 400 | 参数校验失败 / 非 ASO 项目 |
| 404 | projectId / planId / assetId 不存在 |
| **409** | **同一 planId 出图任务进行中** / **同一 sourceAssetId 变体生成进行中** |
| 500 | AI/OSS 内部错误 |

错误 body：`{ code: 500, message: "..." }`
