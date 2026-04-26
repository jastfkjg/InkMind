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
} from "@ant-design/icons";
import { apiErrorMessage, fetchNovel } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
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

  const themeMenuItems = [
    {
      key: "light",
      icon: <SunOutlined />,
      label: "日间",
      onClick: () => setTheme("light"),
      disabled: theme === "light",
    },
    {
      key: "sepia",
      icon: <EyeOutlined />,
      label: "护眼",
      onClick: () => setTheme("sepia"),
      disabled: theme === "sepia",
    },
    {
      key: "dark",
      icon: <MoonOutlined />,
      label: "夜间",
      onClick: () => setTheme("dark"),
      disabled: theme === "dark",
    },
  ];

  const userMenuItems = [
    {
      key: "usage",
      icon: <BarChartOutlined />,
      label: "Token 用量",
      onClick: () => nav("/usage"),
    },
    {
      key: "divider",
      type: "divider" as const,
    },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
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
          <span>设定</span>
        </Space>
      ),
    },
    {
      key: "write",
      label: (
        <Space>
          <EditOutlined />
          <span>写作</span>
        </Space>
      ),
    },
    {
      key: "people",
      label: (
        <Space>
          <TeamOutlined />
          <span>人物</span>
        </Space>
      ),
    },
    {
      key: "memos",
      label: (
        <Space>
          <FileTextOutlined />
          <span>备忘</span>
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

  const bgColor = isDark ? "#1a1a2e" : isSepia ? "#f4ecd8" : "#f6f2ea";
  const bgLinear = isDark ? "linear-gradient(180deg, #16213e 0%, #1a1a2e 35%)" : 
                      isSepia ? "linear-gradient(180deg, #e8dcc0 0%, #f4ecd8 35%)" : 
                      "linear-gradient(180deg, #f0e9df 0%, #f6f2ea 35%)";
  const bgRadial = isDark ? "none" : 
                     isSepia ? "radial-gradient(ellipse 120% 80% at 50% -20%, #faf6e9 0%, transparent 55%)" :
                     "radial-gradient(ellipse 120% 80% at 50% -20%, #fff8f0 0%, transparent 55%)";
  const headerBg = isDark ? "#16213e" : isSepia ? "#faf6e9" : "#fffcf7";
  const headerBorder = isDark ? "#374151" : isSepia ? "#e0d0b0" : "#e7e0d5";
  const textColor = isDark ? "#e8e8e8" : isSepia ? "#5c4b37" : "#1c1917";
  const primaryColor = isDark ? "#f97316" : "#7c2d12";

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
            返回
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
                {novel.title || "未命名作品"}
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
                size={32}
                icon={<UserOutlined />}
                style={{
                  background: primaryColor,
                  transition: "background-color 0.3s ease",
                }}
              >
                {user?.display_name?.charAt(0) || user?.email?.charAt(0)}
              </Avatar>
              <Text strong style={{ color: textColor, transition: "color 0.3s ease" }}>
                {user?.display_name || user?.email}
              </Text>
            </div>
          </Dropdown>
        </Space>
      </Header>

      {err && (
        <div style={{ padding: "0 1.5rem", paddingTop: "1rem" }}>
          <Alert
            message="操作失败"
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
