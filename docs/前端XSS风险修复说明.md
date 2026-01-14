# 前端 XSS 风险修复说明

## 问题描述

**问题编号**: 1.5
**严重程度**: 🔴 高危
**文件**: `frontend/src/lib/auth.ts`

前端将用户信息存储在 `localStorage` 中。如果应用存在 XSS 漏洞，攻击者可以窃取这些信息。

```typescript
// 原始代码（不安全）
export function setUser(user: any) {
    localStorage.setItem("user", JSON.stringify(user));
}

export function getUser(): any | null {
    const str = localStorage.getItem("user");
    return str ? JSON.parse(str) : null;
}
```

## 安全风险

- localStorage 会永久存储数据（直到手动清除），即使关闭浏览器也仍然存在
- 数据在同源的所有标签页间共享，增加了泄露风险
- 如果存在 XSS 漏洞，攻击者可以长期访问存储的用户信息

## 修复方案

使用 **sessionStorage 替代 localStorage**

### 1. 使用 sessionStorage 替代 localStorage

**sessionStorage** 和 **localStorage** 的区别：

| 特性 | localStorage | sessionStorage |
|------|-------------|----------------|
| 存储期限 | 永久（直到手动清除） | 会话期间（关闭页面即清除） |
| 作用域 | 同源的所有标签页共享 | 仅当前标签页有效 |
| 安全性 | 较低（长期存储易被窃取） | 较高（短期存储降低风险） |

### 2. 修改存储方式

```typescript
export function setUser(user: any) {
    if (typeof window === "undefined") return;
    // 使用 sessionStorage 存储用户信息
    const safeUser = {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        role: user.role,
        role_display: user.role_display,
    };
    sessionStorage.setItem("user", JSON.stringify(safeUser));
}

export function getUser(): any | null {
    if (typeof window === "undefined") return null;
    const str = sessionStorage.getItem("user");
    if (!str) return null;
    try {
        return JSON.parse(str);
    } catch {
        return null;
    }
}

export function clearTokens() {
    if (typeof window === "undefined") return;
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    sessionStorage.removeItem("user");  // 同时清除 sessionStorage
}
```

### 3. 前端使用

前端代码无需修改，`getUser()` 返回的对象包含 `role` 字段，可以正常用于权限判断：

```typescript
const currentUser = getUser();

// 菜单权限判断
{currentUser?.role === "admin" && (
    <Menu.Item key="/users">用户管理</Menu.Item>
)}

// 角色标签显示
<Tag color={currentUser?.role === "admin" ? "red" : "default"}>
    {currentUser?.role_display}
</Tag>
```

## 安全改进

1. **降低 XSS 攻击影响**
   - sessionStorage 在关闭页面后自动清除
   - 数据不会跨标签页共享
   - 减少了攻击者获取信息的时间窗口

2. **保持用户体验**
   - `username`、`real_name`、`role` 等字段可以正常显示
   - 权限判断逻辑无需修改
   - 不影响现有功能

3. **Token 仍使用 localStorage**
   - `access_token` 和 `refresh_token` 仍存储在 localStorage（因为需要持久化）
   - Token 本身通过 HttpOnly Cookie 会更安全，但需要后端配合

## 存储的数据

**sessionStorage 中的 user 对象**（关闭页面即清除）：
```json
{
  "id": 1,
  "username": "admin",
  "real_name": "管理员",
  "role": "admin",
  "role_display": "管理员"
}
```

**localStorage 中的 tokens**（持久化存储）：
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc..."
}
```

## 测试建议

### 1. 功能测试

- [ ] 用户登录后，右上角正确显示用户名和角色标签
- [ ] 管理员可以看到"公告管理"、"用户管理"、"操作日志"菜单
- [ ] 非管理员看不到管理菜单
- [ ] 关闭页面后重新打开，需要重新登录（sessionStorage 已清除）

### 2. 安全测试

- [ ] 打开浏览器开发者工具，检查 sessionStorage 中的 user 对象
  - 应该包含：id, username, real_name, role, role_display
- [ ] 检查 localStorage 中的 tokens
  - access_token 和 refresh_token 仍然存在（这是正常的）
  - localStorage 中不应该有 user 字段
- [ ] 关闭浏览器标签页后，sessionStorage 中的 user 应该被清除
- [ ] 打开新的标签页访问同一域名，sessionStorage 应该是空的

### 3. 跨标签页测试

- [ ] 在标签页 A 中登录
- [ ] 在标签页 B 中访问同一域名（不登录）
- [ ] 标签页 B 不应该看到标签页 A 的用户信息（sessionStorage 不共享）

## 后续建议

1. **实现 CSP (Content Security Policy)**
   - 在 Next.js 配置中添加 CSP 头
   - 进一步防止 XSS 攻击

2. **使用 HttpOnly Cookie 存储 Token**
   - Token 无法通过 JavaScript 访问
   - 需要后端配合修改认证流程

3. **定期安全审计**
   - 使用自动化工具扫描 XSS 漏洞
   - 人工审查用户输入处理逻辑

## 总结

通过将用户信息从 localStorage 迁移到 sessionStorage，我们有效降低了 XSS 攻击的风险。主要改进：

- **短期存储**: sessionStorage 在关闭页面后自动清除，不会长期存储用户数据
- **标签页隔离**: 数据只在当前标签页有效，不会跨标签页共享
- **功能完整**: username、role 等字段可以正常显示和用于权限判断
- **简化实现**: 不需要额外的 API 调用，代码改动最小

---

**修复日期**: 2026-01-14
**修复状态**: ✅ 已完成
