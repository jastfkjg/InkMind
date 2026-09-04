# README 展示图片 / Screenshot notes

这些 JPEG 是当前应用的真实浏览器截图，未拼接或修改界面。截图使用中文 UI 和虚构作品《山海来信》，账户 `writer@example.invalid` 为本地演示身份；没有访问生产数据库或调用真实模型。中英文 README 共用这组图片。

These are unedited browser captures of the application, using the Chinese UI and fictional in-memory data. Both READMEs share the same images. No production data or live model responses are shown.

## 本地复现 / Reproduce locally

在 `frontend/` 下打开两个终端：

```bash
node tests/ui-fixture.mjs --demo
```

```bash
VITE_API_URL=http://127.0.0.1:18991 npm run dev -- --host 127.0.0.1 --port 5198 --strictPort
```

访问 `http://127.0.0.1:5198`，使用演示邮箱与任意非空测试密码登录。建议使用干净浏览器配置，避免旧草稿、章节位置或阅读设置影响截图。只对《山海来信》进行写作交互，另外两张作品卡片仅用于列表展示。服务只允许本机访问，拍摄后停止两个进程。

Open the URL above and sign in with the demo email and any nonempty test password. Use a clean browser profile. Only “山海来信” supports editor interactions; the other library cards are display-only. Keep both servers local and stop them after capture.

## 截图状态 / Capture states

| 文件 / File | 视口 / Viewport | 界面状态 / State |
| --- | --- | --- |
| `library.jpg` | 1440 × 900 | 浅色作品列表，最近编辑排序 / Light library, recently edited |
| `writing.jpg` | 1440 × 900 | 第一章、侧栏展开、已保存 / First chapter, sidebar open, saved |
| `ai-tools.jpg` | 1440 × 900 | 浅色生成表单，不执行生成 / Light generation form, no model call |
| `focus-dark.jpg` | 1440 × 900 | 深色专注模式，行宽“适中” / Dark focus, medium line width |
| `mobile-light.jpg` | 390 × 844 | 浅色写作，侧栏关闭 / Light editor, sidebar closed |
| `mobile-dark.jpg` | 390 × 844 | 深色生成底部面板 / Dark generation bottom panel |

正文使用 17px 字号、1.85 行高。常规桌面截图使用“铺满”行宽，专注截图使用“适中”。等待字体、页面切换动画与保存状态稳定，关闭菜单和提示，再捕获视口（不是整页长截图）。不要为截图修改 DOM，也不要把测试流式输出当作真实生成效果。

Use 17px text and 1.85 line height. Desktop editor captures use full width; focus mode uses medium width. Wait for fonts, transitions, and save status to settle, close incidental menus, and capture the viewport. Do not alter the DOM or present fixture output as a real generation result.

手机图是浏览器窄视口截图，不代表已验证手机原生键盘。[完整回归清单 / Regression checklist](../../frontend/tests/README.md)。
