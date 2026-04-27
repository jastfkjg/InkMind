import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppWithTheme />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
