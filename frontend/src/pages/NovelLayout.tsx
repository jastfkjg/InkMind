import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Layout,
  Tabs,
  Button,
  Alert,
  Typography,
  Dropdown,
  Avatar,
  Space,
  Tag,
} from "antd";
import {
  ArrowLeftOutlined,
  UserOutlined,
  SettingOutlined,
  EditOutlined,
  TeamOutlined,
  FileTextOutlined,
  LogoutOutlined,
  BarChartOutlined,
  SunOutlined,
  MoonOutlined,
  EyeOutlined,
  HistoryOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import { apiErrorMessage, fetchNovel } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import type { Novel } from "@/types";

const { Header, Content } = Layout;
const { Title, Text } = Typography;

export default function NovelLayout() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout } = useAuth();
  const { theme, setTheme, isDark, isSepia } = useTheme();
  const { t, setLanguage, isZh } = useI18n();

  const peopleTabActive = loc.pathname.startsWith(`/novels/${id}/people`);
  const memosTabActive = loc.pathname.startsWith(`/novels/${id}/memos`);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!Number.isFinite(id)) {
      nav("/", { replace: true });
      return;
    }
    (async () => {
      try {
        const n = await fetchNovel(id);
        setNovel(n);
      } catch (e) {
        setErr(apiErrorMessage(e));
      }
    })();
  }, [id, nav]);

  if (!Number.isFinite(id)) {
    return null;
  }

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
      },
    },
  ];

  const tabItems = [
    {
      key: "settings",
      label: (
        <Space>
          <SettingOutlined />
          <span>{t("novel_tab_settings")}</span>
        </Space>
      ),
    },
    {
      key: "write",
      label: (
        <Space>
          <EditOutlined />
          <span>{t("novel_tab_write")}</span>
        </Space>
      ),
    },
    {
      key: "people",
      label: (
        <Space>
          <TeamOutlined />
          <span>{t("novel_tab_people")}</span>
        </Space>
      ),
    },
    {
      key: "memos",
      label: (
        <Space>
          <FileTextOutlined />
          <span>{t("novel_tab_memos")}</span>
        </Space>
      ),
    },
  ];

  const getActiveTab = () => {
    if (loc.pathname.includes("/settings")) return "settings";
    if (loc.pathname.includes("/write")) return "write";
    if (peopleTabActive) return "people";
    if (memosTabActive) return "memos";
    return "write";
  };

  const handleTabChange = (key: string) => {
    nav(`/novels/${id}/${key}`);
  };

  const bgColor = isDark ? "#181715" : isSepia ? "#f5eddd" : "#f5f0e8";
  const bgLinear = isDark ? "linear-gradient(180deg, #1e1d1b 0%, #181715 35%)" : 
                      isSepia ? "linear-gradient(180deg, #efe2c9 0%, #f5eddd 35%)" : 
                      "linear-gradient(180deg, #e6dfd8 0%, #f5f0e8 35%)";
  const bgRadial = isDark ? "none" : 
                     isSepia ? "radial-gradient(ellipse 120% 80% at 50% -20%, #faf9f5 0%, transparent 55%)" :
                     "radial-gradient(ellipse 120% 80% at 50% -20%, #faf9f5 0%, transparent 55%)";
  const headerBg = isDark ? "#1e1d1b" : isSepia ? "#faf9f5" : "#faf9f5";
  const headerBorder = isDark ? "#2a2926" : isSepia ? "#d9cbb0" : "#e6dfd8";
  const textColor = isDark ? "#e7e5e1" : isSepia ? "#4a392b" : "#141413";
  const primaryColor = "#cc785c";

  const getThemeIcon = () => {
    if (theme === "dark") return <MoonOutlined />;
    if (theme === "sepia") return <EyeOutlined />;
    return <SunOutlined />;
  };

  return (
    <Layout
      style={{
        minHeight: "100vh",
        background: bgColor,
        backgroundImage: bgRadial ? `${bgRadial}, ${bgLinear}` : bgLinear,
        transition: "background-color 0.3s ease",
      }}
    >
      <Header
        style={{
          padding: "0 1.5rem",
          background: headerBg,
          borderBottom: `1px solid ${headerBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
          flexWrap: "wrap",
          gap: "1rem",
          transition: "background-color 0.3s ease, border-color 0.3s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            flex: 1,
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => nav("/")}
            size="large"
          >
            {t("nav_back")}
          </Button>

          {novel && (
            <Space size="small" style={{ flexShrink: 0 }}>
              <Title
                level={5}
                style={{
                  margin: 0,
                  fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                  color: textColor,
                  transition: "color 0.3s ease",
                }}
              >
                {novel.title || t("novel_untitled")}
              </Title>
              {novel.genre && (
                <Tag color="blue" style={{ margin: 0 }}>
                  {novel.genre}
                </Tag>
              )}
            </Space>
          )}

          <Tabs
            activeKey={getActiveTab()}
            items={tabItems}
            onChange={handleTabChange}
            style={{ marginBottom: 0, marginLeft: "0.5rem" }}
            size="large"
          />
        </div>

        <Space size="small">
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
                transition: "background 0.2s",
              }}
            >
              <Avatar
                size={36}
                icon={<UserOutlined />}
                style={{
                  background: primaryColor,
                  transition: "background-color 0.3s ease",
                }}
              >
                {user?.display_name?.charAt(0) || user?.email?.charAt(0)}
              </Avatar>
              <div style={{ lineHeight: 1.2 }}>
                <Text
                  strong
                  style={{
                    display: "block",
                    color: textColor,
                    fontSize: "0.9rem",
                    transition: "color 0.3s ease",
                  }}
                >
                  {user?.display_name || user?.email}
                </Text>
                {user?.display_name && (
                  <Text
                    type="secondary"
                    style={{
                      display: "block",
                      fontSize: "0.75rem",
                      color: textColor,
                      opacity: 0.6,
                      transition: "color 0.3s ease",
                    }}
                  >
                    {user.email}
                  </Text>
                )}
              </div>
            </div>
          </Dropdown>
        </Space>
      </Header>

      {err && (
        <div style={{ padding: "0 1.5rem", paddingTop: "1rem" }}>
          <Alert
            message={t("operation_failed_title")}
            description={err}
            type="error"
            showIcon
          />
        </div>
      )}

      <Content
        style={{
          padding: "1rem",
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <Outlet context={{ novel, setNovel }} />
      </Content>
    </Layout>
  );
}
