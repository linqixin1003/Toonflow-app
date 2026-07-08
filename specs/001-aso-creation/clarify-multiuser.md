# Clarify: 多用户并发访问

**Date**: 2026-07-08  
**Status**: **Out of Scope** — 不实现多账号与数据隔离；与原版 Toonflow 单账号模型一致。

## 产品决策（2026-07-08）

- 不做多账号、不做 `userId` 项目隔离、不做用户管理 API
- ASO 实施**跳过**原 Phase −1 全部任务
- 下文保留作架构审计参考

---

## ~~C-005 — 多用户同时访问~~ → 已取消

**需求**：多人可同时访问系统，各自使用**不同账号、密码**，数据互不干扰。

---

## 现状分析（代码审计）

| 能力 | 现状 | 结论 |
|------|------|------|
| JWT 登录 | ✅ `/api/login/login` 签发 token，`req.user = { id, name }` | 已支持**无状态并发会话**（多人同时在线） |
| 接口鉴权 | ✅ 除 login 外全局 JWT 中间件 | 未登录无法调 API |
| 多账号 | ❌ 种子数据仅 `admin`/`admin123` 一条 | **缺多用户账号** |
| 用户管理 API | ⚠️ 仅 `getUser`（取第一条）、`updateUserPwd`（改密码） | **无创建/列表/删除用户** |
| 项目归属 | ⚠️ `o_project.userId` 字段存在，但 `addProject` **写死 `userId: 1`** | 未绑定登录用户 |
| 项目隔离 | ❌ `getProject` 返回**全部项目**，无 `userId` 过滤 | **所有人看到所有项目** |
| ASO/业务 API | ❌ `req.user` **从未被业务路由读取** | 无数据隔离 |
| 密码存储 | ⚠️ 明文存 DB | 安全风险，fork 自用可分期改进 |

**结论**：并发连接能力已有；**缺的是账号体系 + 按用户隔离数据**。ASO 功能 MUST 建立在此基础之上，不能重复踩坑。

---

## 决策

### D-001 用户模型

- 继续使用 `o_user` 表（id, name, password）
- v1 **管理员创建用户**（不开放自助注册），避免 spam
- 默认保留 `admin` 超级管理员，可管理用户列表

### D-002 会话与并发

- 继续 JWT（180 天有效期），**无需 Session 服务器**
- 多人同时登录、同时操作 ASO 项目：**天然支持**
- SQLite 写锁：高并发写时串行化；ASO 团队规模（≤10 人）可接受；后续可换 PostgreSQL

### D-003 数据隔离规则

| 实体 | 隔离键 | 规则 |
|------|--------|------|
| `o_project` | `userId` | 用户只能 CRUD **自己的**项目 |
| ASO workspace / 素材 / 成品 | `projectId` → `userId` | 通过项目归属间接隔离 |
| `o_setting` / 供应商配置 | 全局 | **共享**（团队共用 AI 配置，减少重复配置） |
| `o_agentDeploy` | 全局 | 共享 |
| `o_user` | — | 仅 admin 可管理 |

> 若未来需要「每用户独立 API Key」，再扩展 `o_vendorConfig` 按 userId 分表；v1 不做。

### D-004 ASO 专项

所有 `/api/aso/*` 在 `assertAsoProject` 内增加：

```typescript
assertProjectOwner(projectId, req.user.id)
// SELECT userId FROM o_project WHERE id = ? 
// userId !== req.user.id → 403
```

### D-005 密码

- **MVP**：沿用现有明文比对（与 novel/script 一致，改动面小）
- **P2**：bcrypt 哈希 + 迁移脚本（可选，fork 自用可后置）

---

## 新增 API（平台级，ASO 前置）

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/setting/loginConfig/listUsers` | 用户列表 | admin |
| POST | `/api/setting/loginConfig/addUser` | 创建用户 | admin |
| POST | `/api/setting/loginConfig/deleteUser` | 删除用户 | admin |
| POST | `/api/setting/loginConfig/updateUserPwd` | 改密（已有，保留） | admin 或本人 |

---

## 需修改的现有 API（平台级）

| 文件 | 变更 |
|------|------|
| `routes/project/addProject.ts` | `userId: req.user.id` |
| `routes/project/getProject.ts` | `WHERE userId = req.user.id` |
| `routes/project/editProject.ts` | 校验归属 |
| `routes/project/delProject.ts` | 校验归属 |
| `routes/general/updateProject.ts` | 校验归属 |
| 所有带 `projectId` 的路由 | 可选：抽 `assertProjectOwner` 中间件 |

ASO 新路由统一调用 `assertProjectOwner`。

---

## 前端（Toonflow-web）

- 设置 → 用户管理：列表 / 新增 / 删除 / 改密
- 项目列表仅显示当前用户项目
- 登录页不变（已有 username/password）

---

## 验收场景

1. **Given** admin 创建 userA、userB，**When** 两人同时登录，**Then** 各自获得独立 token，互不影响
2. **Given** userA 创建 ASO 项目 P1，**When** userB 调 getProject，**Then** 看不到 P1
3. **Given** userB 猜到 P1 的 projectId，**When** 调 `/api/aso/getWorkspace`，**Then** 403
4. **Given** userA、userB 同时生成 ASO 方案，**When** 并发请求，**Then** 各自 workspace 独立、不串数据
