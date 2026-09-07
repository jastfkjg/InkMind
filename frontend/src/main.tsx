import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { NavigationProvider } from "@/context/NavigationContext";
import { I18nProvider, useI18n } from "@/i18n";
import App from "@/App";
import { getThemeConfig } from "@/styles/theme";
import "@/styles/global.css";

function AppWithTheme() {
  const { theme } = useTheme();
  const { isZh } = useI18n();
  const themeConfig = getThemeConfig(theme);

  return (
    <ConfigProvider theme={themeConfig} locale={isZh ? zhCN : enUS}>
        <NavigationProvider>
          <App />
        </NavigationProvider>
    </ConfigProvider>
  );
}

// A data router enables navigation blocking without changing the existing route tree.
const router = createBrowserRouter([{
  path: "*",
  element: <AuthProvider><I18nProvider><AppWithTheme /></I18nProvider></AuthProvider>,
}]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>
);
