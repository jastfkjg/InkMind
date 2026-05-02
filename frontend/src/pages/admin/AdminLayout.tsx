import { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Layout,
  Menu,
  Typography,
  Dropdown,
  Avatar,
  Button,
  Space,
} from "antd";
import {
  UserOutlined,
  TeamOutlined,
  FileTextOutlined,
  LogoutOutlined,
  SafetyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  BarChartOutlined,
  HistoryOutlined,
  ArrowLeftOutlined,
  SunOutlined,
  MoonOutlined,
  EyeOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import { useNavigation } from "@/context/NavigationContext";

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const { theme, setTheme, isDark, isSepia } = useTheme();
  const { t, setLanguage, isZh } = useI18n();
  const nav = useNavigate();
  const { goBackSmart } = useNavigation();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (user && !user.is_admin) {
      nav("/");
    }
  }, [user, nav]);

  const menuItems = [
    {
      key: "/admin/users",
      icon: <TeamOutlined />,
      label: t("nav_admin_users"),
      onClick: () => nav("/admin/users"),
    },
    {
      key: "/admin/logs",
      icon: <FileTextOutlined />,
      label: t("nav_admin_logs"),
      onClick: () => nav("/admin/logs"),
    },
  ];

  const getSelectedKey = () => {
    const path = location.pathname;
    if (path.startsWith("/admin/users")) return "/admin/users";
    if (path.startsWith("/admin/logs")) return "/admin/logs";
    return "/admin/users";
  };

  const bgColor = isDark ? "#181715" : "#f5f0e8";
  const headerBg = isDark ? "#1e1d1b" : isSepia ? "#faf9f5" : "#faf9f5";
  const headerBorder = isDark ? "#2a2926" : isSepia ? "#d9cbb0" : "#e6dfd8";
  const textColor = isDark ? "#e7e5e1" : isSepia ? "#4a392b" : "#141413";
  const secondaryTextColor = isDark ? "#a3a19b" : isSepia ? "#8b7762" : "#6c6a64";
  const menuBg = isDark ? "#1e1d1b" : isSepia ? "#faf9f5" : "#faf9f5";

  const languageMenuItems = [
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
  ];

  const themeMenuItems = [
    {
      key: "light",
      icon: <SunOutlined />,
      label: t("theme_light"),
      onClick: () => setTheme("light"),
      disabled: theme === "light",
    },
    {
      key: "sepia",
      icon: <EyeOutlined />,
      label: t("theme_sepia"),
      onClick: () => setTheme("sepia"),
      disabled: theme === "sepia",
    },
    {
      key: "dark",
      icon: <MoonOutlined />,
      label: t("theme_dark"),
      onClick: () => setTheme("dark"),
      disabled: theme === "dark",
    },
  ];

  const userMenuItems = [
    {
      key: "admin",
      icon: <SafetyOutlined />,
      label: t("nav_admin"),
      disabled: true,
    },
    {
      key: "settings",
      icon: <SettingOutlined />,
      label: t("nav_ai_settings"),
      onClick: () => nav("/settings"),
    },
    {
      key: "usage",
      icon: <BarChartOutlined />,
      label: t("nav_usage"),
      onClick: () => nav("/usage"),
    },
    {
      key: "tasks",
      icon: <HistoryOutlined />,
      label: t("nav_background_tasks"),
      onClick: () => nav("/tasks"),
    },
    {
      key: "divider",
      type: "divider" as const,
    },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: t("nav_logout"),
      danger: true,
      onClick: () => {
        logout();
        nav("/login");
      },
    },
  ];

  const getThemeIcon = () => {
    if (theme === "dark") return <MoonOutlined />;
    if (theme === "sepia") return <EyeOutlined />;
    return <SunOutlined />;
  };

  return (
    <Layout
      className={`ops-page ops-admin-shell ${isDark ? "ops-page--dark" : ""}`}
      style={{ minHeight: "100vh", background: bgColor }}
    >
      <Sider
        theme={isDark ? "dark" : "light"}
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={236}
        style={{
          background: menuBg,
          borderRight: `1px solid ${headerBorder}`,
        }}
      >
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? 0 : "0 24px",
            borderBottom: `1px solid ${headerBorder}`,
          }}
        >
          <SafetyOutlined
            style={{
              fontSize: 24,
              color: "#cc785c",
            }}
          />
          {!collapsed && (
            <Title
              level={5}
              style={{
                margin: "0 0 0 12px",
                color: textColor,
                fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
              }}
            >
              {t("nav_admin")}
            </Title>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          items={menuItems}
          style={{
            background: "transparent",
            borderRight: "none",
          }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: "0 24px",
            background: headerBg,
            borderBottom: `1px solid ${headerBorder}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 64,
          }}
        >
          <Space size="middle">
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: 16, width: 40, height: 40 }}
            />
            <div>
              <Text strong style={{ display: "block", color: textColor }}>
                {getSelectedKey() === "/admin/logs"
                  ? t("admin_logs_title")
                  : t("admin_users_title")}
              </Text>
              <Text type="secondary" style={{ color: secondaryTextColor, fontSize: 12 }}>
                {t("admin_workspace_hint")}
              </Text>
            </div>
          </Space>
          <Space>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => goBackSmart()}
              size="large"
              style={{ height: 40 }}
            >
              {t("nav_back")}
            </Button>

            <Dropdown menu={{ items: languageMenuItems }} placement="bottomRight">
              <Button
                type="text"
                icon={<GlobalOutlined />}
                size="large"
                style={{
                  color: textColor,
                  transition: "color 0.3s ease",
                }}
              >
                {isZh ? "中文" : "EN"}
              </Button>
            </Dropdown>

            <Dropdown menu={{ items: themeMenuItems }} placement="bottomRight">
              <Button
                type="text"
                icon={getThemeIcon()}
                size="large"
                style={{
                  color: textColor,
                  transition: "color 0.3s ease",
                }}
              />
            </Dropdown>

            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  cursor: "pointer",
                  padding: "0.4rem 0.75rem",
                  borderRadius: 8,
                }}
              >
                <Avatar
                  size={32}
                  icon={<UserOutlined />}
                  style={{ background: "#cc785c" }}
                >
                  {user?.display_name?.charAt(0) || user?.email?.charAt(0)}
                </Avatar>
                {!collapsed && (
                  <div style={{ lineHeight: 1.2 }}>
                    <Text
                      strong
                      style={{
                        display: "block",
                        color: textColor,
                        fontSize: "0.85rem",
                      }}
                    >
                      {user?.display_name || user?.email}
                    </Text>
                    {user?.display_name && (
                      <Text
                        type="secondary"
                        style={{
                          display: "block",
                          fontSize: "0.7rem",
                          color: secondaryTextColor,
                        }}
                      >
                        {user.email}
                      </Text>
                    )}
                  </div>
                )}
              </div>
            </Dropdown>
          </Space>
        </Header>
        <Content
          style={{
            margin: 0,
            padding: 28,
            minHeight: 280,
          }}
        >
          <div className="ops-admin-content">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
