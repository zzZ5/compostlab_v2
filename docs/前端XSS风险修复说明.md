# 前端 XSS 风险修复说明

## 问题描述

**问题编号**: 1.5
**严重程度**: 🔴 高危
**文件**: `frontend/src/lib/auth.ts`

前端将用户信息（包括敏感字段如 `role`、`is_staff`、`is_superuser`）存储在 `localStorage` 中。如果应用存在 XSS 漏洞，攻击者可以窃取这些信息。

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

- XSS 攻击可以窃取用户身份信息
- 攻击者可以模拟用户操作
- 可能导致会话劫持

## 修复方案

采用**方案 2: 使用 sessionStorage 并只存储非敏感信息**

### 1. 使用 sessionStorage 替代 localStorage

**sessionStorage** 和 **localStorage** 的区别：

| 特性 | localStorage | sessionStorage |
|------|-------------|----------------|
| 存储期限 | 永久（直到手动清除） | 会话期间（关闭页面即清除） |
| 作用域 | 同源的所有标签页共享 | 仅当前标签页有效 |
| 安全性 | 较低（长期存储易被窃取） | 较高（短期存储降低风险） |

### 2. 只存储非敏感信息

修改 `setUser` 函数，只存储用于显示的字段：

```typescript
export function setUser(user: any) {
    if (typeof window === "undefined") return;
    // 只存储非敏感信息，避免 XSS 窃取敏感字段
    const safeUser = {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        role_display: user.role_display,
        // 不存储 role、is_staff、is_superuser 等敏感字段
        // 这些字段应该通过 API 动态获取
    };
    sessionStorage.setItem("user", JSON.stringify(safeUser));
}
```

### 3. 动态获取完整用户信息

添加新函数 `fetchFullUserInfo`，通过 API 获取完整的用户信息（包含权限字段）：

```typescript
/**
 * 获取完整的用户信息（包含权限字段）
 * 通过 API 动态获取，避免在本地存储敏感信息
 */
export async function fetchFullUserInfo(): Promise<any> {
    const token = getAccessToken();
    if (!token) return null;

    try {
        const response = await fetch("/api/v2/auth/me", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            return null;
        }

        const user = await response.json();
        return user;
    } catch {
        return null;
    }
}
```

### 4. 更新前端代码

修改 `frontend/src/app/(main)/layout.tsx`，使用 `fetchFullUserInfo` 获取完整用户信息用于权限判断：

```typescript
// 添加 fullUserInfo 状态
const [fullUserInfo, setFullUserInfo] = useState<any>(null);

// 在 useEffect 中加载完整用户信息
useEffect(() => {
    const ok = typeof window !== "undefined" ? (hasToken() || hasBasicAuth()) : true;
    if (!ok) {
        const next = encodeURIComponent(pathname);
        router.replace(`/login?next=${next}`);
        return;
    }
    // 加载基本信息（用于显示）
    if (typeof window !== "undefined") {
        setCurrentUser(getUser());
    }
    // 加载完整用户信息（包含权限字段，用于权限判断）
    fetchFullUserInfo().then(setFullUserInfo);
    setReady(true);
}, [pathname, router]);

// 使用 fullUserInfo 进行权限判断
<Menu
  items={[
    // ...
    ...(fullUserInfo?.role === "admin" || fullUserInfo?.is_staff || fullUserInfo?.is_superuser
      ? [
          { key: "/announcements", label: "公告管理" },
          { key: "/users", label: "用户管理" },
          { key: "/audit-logs", label: "操作日志" },
        ]
      : []),
  ]}
/>
```

## 安全改进

1. **降低 XSS 攻击影响**
   - 敏感信息（role, is_staff, is_superuser）不再存储在客户端
   - 即使发生 XSS，攻击者也无法获取权限信息

2. **减少数据泄露风险**
   - sessionStorage 在关闭页面后自动清除
   - 数据不会跨标签页共享

3. **保持功能完整性**
   - 基本用户信息（用户名、显示名）仍可从 sessionStorage 快速获取
   - 完整用户信息（包含权限）通过 API 动态获取
   - 不影响前端 UI 显示和权限判断

## 测试建议

### 1. 功能测试

- [ ] 用户登录后，右上角正确显示用户名和角色标签
- [ ] 管理员可以看到"公告管理"、"用户管理"、"操作日志"菜单
- [ ] 非管理员看不到管理菜单
- [ ] 关闭页面后重新打开，需要重新登录

### 2. 安全测试

- [ ] 打开浏览器开发者工具，检查 sessionStorage 中的 user 对象
  - 应该只包含：id, username, real_name, role_display
  - 不应该包含：role, is_staff, is_superuser
- [ ] 检查 localStorage 中的 tokens
  - access_token 和 refresh_token 仍然存在（这是正常的）
  - localStorage 中不应该有 user 字段

### 3. 性能测试

- [ ] 页面刷新时，API 请求 `/api/v2/auth/me` 响应正常
- [ ] 菜单渲染延迟不明显

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

通过将敏感用户信息从 localStorage 迁移到 sessionStorage，并只存储非敏感字段，我们有效降低了 XSS 攻击的风险。完整用户信息（包含权限字段）通过 API 动态获取，既保证了安全性，又保持了功能完整性。

---

**修复日期**: 2026-01-14
**修复状态**: ✅ 已完成
