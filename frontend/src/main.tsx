import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ConfigProvider } from "antd";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { NavigationProvider } from "@/context/NavigationContext";
import { I18nProvider } from "@/i18n";
import App from "@/App";
import { getThemeConfig } from "@/styles/theme";
import "@/styles/global.css";

function AppWithTheme() {
  const { theme } = useTheme();
  const themeConfig = getThemeConfig(theme);

  return (
    <ConfigProvider theme={themeConfig}>
      <I18nProvider>
        <NavigationProvider>
          <App />
        </NavigationProvider>
      </I18nProvider>
    </ConfigProvider>
  );
}

// A data router enables navigation blocking without changing the existing route tree.
const router = createBrowserRouter([{
  path: "*",
  element: <AuthProvider><AppWithTheme /></AuthProvider>,
}]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>
);
