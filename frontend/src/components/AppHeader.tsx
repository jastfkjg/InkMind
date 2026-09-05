import { type CSSProperties, type ReactNode, useMemo } from "react";
import { Layout, Button, Space, Typography, Dropdown, Avatar } from "antd";
import {
  UserOutlined,
  LogoutOutlined,
  BarChartOutlined,
  SunOutlined,
  MoonOutlined,
  SettingOutlined,
  HistoryOutlined,
  GlobalOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import { useNavigation } from "@/context/NavigationContext";
import { isDesktopApp } from "@/api/client";

const { Header } = Layout;
const { Text } = Typography;

export interface HeaderThemeColors {
  isDark: boolean;
  bgColor: string;
  bgLinear: string;
  bgRadial: string;
  headerBg: string;
  headerBorder: string;
  textColor: string;
  primaryColor: string;
  secondaryTextColor: string;
  cardBg: string;
}

export function useHeaderTheme(): HeaderThemeColors {
  const { isDark } = useTheme();
  return useMemo(
    () => ({
      isDark,
      bgColor: isDark ? "#181715" : "#f5f0e8",
      bgLinear: isDark
        ? "linear-gradient(180deg, #1e1d1b 0%, #181715 35%)"
        : "linear-gradient(180deg, #e6dfd8 0%, #f5f0e8 35%)",
      bgRadial: isDark
        ? "none"
        : "radial-gradient(ellipse 120% 80% at 50% -20%, #faf9f5 0%, transparent 55%)",
      headerBg: isDark ? "#1e1d1b" : "#faf9f5",
      headerBorder: isDark ? "#2a2926" : "#e6dfd8",
      textColor: isDark ? "#e7e5e1" : "#141413",
      primaryColor: "#cc785c",
      secondaryTextColor: isDark ? "#a3a19b" : "#6c6a64",
      cardBg: isDark ? "#1e1d1b" : "#faf9f5",
    }),
    [isDark]
  );
}

export interface AppHeaderProps {
  leftContent: ReactNode;
  extraActions?: ReactNode;
  disabledMenuItem?: "settings" | "usage" | "tasks";
  height?: number;
  padding?: string;
  onLogout?: () => void;
  headerStyle?: CSSProperties;
}

export default function AppHeader({
  leftContent,
  extraActions,
  disabledMenuItem,
  height = 72,
  padding = "0 2rem",
  onLogout,
  headerStyle,
}: AppHeaderProps) {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { t, isZh, setLanguage } = useI18n();
  const colors = useHeaderTheme();
  const { beforeLeave } = useNavigation();

  const languageMenuItems = useMemo(
    () => [
      {
        key: "zh",
        icon: <GlobalOutlined />,
        label: isZh ? "✓ 中文" : "中文",
        onClick: () => setLanguage("zh"),
      },
      {
        key: "en",
        icon: <GlobalOutlined />,
        label: !isZh ? "✓ English" : "English",
        onClick: () => setLanguage("en"),
      },
    ],
    [isZh, setLanguage]
  );

  const userMenuItems = useMemo(() => {
    const handleLogout = async () => {
      if (await beforeLeave()) (onLogout ?? logout)();
    };
    return [
      ...(user?.is_admin
        ? [
            {
              key: "admin",
              icon: <SafetyOutlined />,
              label: t("nav_admin"),
              onClick: () => nav("/admin/users"),
            },
          ]
        : []),
      {
        key: "settings",
        icon: <SettingOutlined />,
        label: t("nav_ai_settings"),
        disabled: disabledMenuItem === "settings",
        onClick: disabledMenuItem === "settings" ? undefined : () => nav("/settings"),
      },
      {
        key: "usage",
        icon: <BarChartOutlined />,
        label: t("nav_usage"),
        disabled: disabledMenuItem === "usage",
        onClick: disabledMenuItem === "usage" ? undefined : () => nav("/usage"),
      },
      {
        key: "tasks",
        icon: <HistoryOutlined />,
        label: t("nav_background_tasks"),
        disabled: disabledMenuItem === "tasks",
        onClick: disabledMenuItem === "tasks" ? undefined : () => nav("/tasks"),
      },
      ...(!isDesktopApp ? [
        { key: "divider", type: "divider" as const },
        {
          key: "logout",
          icon: <LogoutOutlined />,
          label: t("nav_logout"),
          danger: true,
          onClick: handleLogout,
        },
      ] : []),
    ];
  }, [user?.is_admin, disabledMenuItem, t, nav, onLogout, logout, beforeLeave]);

  return (
    <Header
      className="app-header"
      style={{
        padding,
        background: colors.headerBg,
        borderBottom: `1px solid ${colors.headerBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: height,
        height: "auto",
        transition: "background-color 0.3s ease, border-color 0.3s ease",
        ...headerStyle,
      }}
    >
      <div className="app-header__left">{leftContent}</div>

      <Space size="middle" className="app-header__actions">
        {extraActions}

        <Dropdown menu={{ items: languageMenuItems }} placement="bottomRight" trigger={["click"]}>
          <Button
            type="text"
            className="app-header__preference"
            icon={<GlobalOutlined />}
            size="large"
            style={{ color: colors.textColor, transition: "color 0.3s ease" }}
          >
            {isZh ? "中文" : "EN"}
          </Button>
        </Dropdown>

        <Button
          type="text"
          className="app-header__preference"
          icon={theme === "dark" ? <MoonOutlined /> : <SunOutlined />}
          size="large"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={theme === "dark" ? t("theme_light") : t("theme_dark")}
          style={{ color: colors.textColor, transition: "color 0.3s ease" }}
        />

        <Dropdown menu={{ items: [
          ...userMenuItems,
          { type: "divider" },
          { key: "language", icon: <GlobalOutlined />, label: t("nav_language"), children: languageMenuItems },
          { key: "theme", icon: theme === "dark" ? <SunOutlined /> : <MoonOutlined />, label: theme === "dark" ? t("theme_light") : t("theme_dark"), onClick: () => setTheme(theme === "dark" ? "light" : "dark") },
        ] }} placement="bottomRight" trigger={["click"]}>
          <button
            type="button"
            aria-label={t("nav_account_menu")}
            className="user-menu-trigger"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: "pointer",
              padding: "0.4rem 0.75rem",
              borderRadius: 8,
              transition: "background 0.2s",
            }}
          >
            <Avatar
              size={36}
              icon={<UserOutlined />}
              style={{
                background: colors.primaryColor,
                transition: "background-color 0.3s ease",
              }}
            >
              {user?.display_name?.charAt(0) || user?.email?.charAt(0)}
            </Avatar>
            <span className="app-header__user-details" style={{ lineHeight: 1.2 }}>
              <Text
                strong
                style={{
                  display: "block",
                  color: colors.textColor,
                  fontSize: "0.9rem",
                  transition: "color 0.3s ease",
                }}
              >
                {user?.display_name || user?.email}
              </Text>
              {user?.display_name && !isDesktopApp && (
                <Text
                  type="secondary"
                  style={{
                    display: "block",
                    fontSize: "0.75rem",
                    color: colors.secondaryTextColor,
                    transition: "color 0.3s ease",
                  }}
                >
                  {user.email}
                </Text>
              )}
            </span>
          </button>
        </Dropdown>
      </Space>
    </Header>
  );
}
