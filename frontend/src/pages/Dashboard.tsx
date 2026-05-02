import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Layout,
  Card,
  Typography,
  Button,
  Space,
  List,
  Empty,
  Spin,
  Alert,
  Tag,
  Tooltip,
  Dropdown,
  Avatar,
  message,
  Modal,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  ExportOutlined,
  DeleteOutlined,
  UserOutlined,
  BookOutlined,
  LogoutOutlined,
  BarChartOutlined,
  QuestionCircleOutlined,
  SunOutlined,
  MoonOutlined,
  EyeOutlined,
  SettingOutlined,
  HistoryOutlined,
  GlobalOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import {
  apiErrorMessage,
  createNovel,
  deleteNovel,
  fetchNovels,
} from "@/api/client";
import ExportNovelModal from "@/components/ExportNovelModal";
import { QuotaWarning } from "@/components/QuotaWarning";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/i18n";
import type { Novel } from "@/types";
import { isNovelSetupComplete, novelPrimaryHref } from "@/utils/novelSetup";

const { Header, Content } = Layout;
const { Title, Text } = Typography;
const { confirm } = Modal;

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { theme, setTheme, isDark, isSepia } = useTheme();
  const { t, setLanguage, isZh } = useI18n();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [exportNovel, setExportNovel] = useState<Novel | null>(null);
  const nav = useNavigate();

  async function load() {
    setErr("");
    try {
      const list = await fetchNovels();
      setNovels(list);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate() {
    setCreating(true);
    try {
      const n = await createNovel({ title: t("dashboard_untitled") });
      setNovels((prev) => [n, ...prev]);
      message.success(t("create_novel_success"));
      nav(novelPrimaryHref(n));
    } catch (e) {
      setErr(apiErrorMessage(e));
      message.error(t("dashboard_create_failed"));
    } finally {
      setCreating(false);
    }
  }

  function showDeleteConfirm(novel: Novel) {
    confirm({
      title: t("dashboard_delete_confirm_title"),
      content: t("dashboard_delete_confirm_content").replace("{title}", novel.title || t("dashboard_untitled")),
      okText: t("dashboard_yes_delete"),
      okType: "danger",
      cancelText: t("common_cancel"),
      async onOk() {
        try {
          await deleteNovel(novel.id);
          setNovels((prev) => prev.filter((x) => x.id !== novel.id));
          message.success(t("dashboard_delete_success"));
        } catch (e) {
          setErr(apiErrorMessage(e));
          message.error(t("dashboard_delete_failed"));
        }
      },
    });
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
        message.success(t("dashboard_logged_out"));
      },
    },
  ];

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
  const cardBg = isDark ? "#1e1d1b" : isSepia ? "#faf9f5" : "#faf9f5";
  const secondaryTextColor = isDark ? "#a3a19b" : isSepia ? "#8b7762" : "#6c6a64";

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
          padding: "0 2rem",
          background: headerBg,
          borderBottom: `1px solid ${headerBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 72,
          transition: "background-color 0.3s ease, border-color 0.3s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <BookOutlined
            style={{
              fontSize: "1.75rem",
              color: isDark ? "#cc785c" : "#cc785c",
            }}
          />
          <Title
            level={3}
            style={{
              margin: 0,
              fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
              color: textColor,
              fontSize: "1.35rem",
              transition: "color 0.3s ease",
            }}
          >
            {t("app_name")}
          </Title>
        </div>

        <Space size="middle">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={onCreate}
            loading={creating}
            size="large"
            style={{
              height: 40,
              paddingLeft: 20,
              paddingRight: 20,
            }}
          >
            {t("dashboard_create_novel")}
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
              icon={theme === "dark" ? <MoonOutlined /> : theme === "sepia" ? <EyeOutlined /> : <SunOutlined />}
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
              className="user-menu-trigger"
            >
              <Avatar
                size={36}
                icon={<UserOutlined />}
                style={{
                  background: "#cc785c",
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
                      color: secondaryTextColor,
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

      <Content
        style={{
          padding: "2rem",
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {err && (
          <Alert
            message={t("operation_failed_title")}
            description={err}
            type="error"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        <QuotaWarning />

        <Spin spinning={loading}>
          {novels.length === 0 ? (
            <Card
              style={{
                borderRadius: 16,
                border: "none",
                boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                background: cardBg,
                transition: "background-color 0.3s ease, box-shadow 0.3s ease",
              }}
            >
              <Empty
                description={
                  <div>
                    <Title level={4} style={{ marginBottom: "0.5rem", color: textColor }}>
                      {t("dashboard_no_novels")}
                    </Title>
                    <Text type="secondary">
                      {t("dashboard_no_novels_desc")}
                    </Text>
                  </div>
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </Card>
          ) : (
            <div>
              <Title
                level={4}
                style={{
                  marginBottom: "1rem",
                  fontFamily: '"Source Sans 3", system-ui, sans-serif',
                  color: textColor,
                  transition: "color 0.3s ease",
                }}
              >
                {t("dashboard_title")} ({novels.length})
              </Title>

              <List
                grid={{
                  gutter: [24, 24],
                  xs: 1,
                  sm: 1,
                  md: 2,
                  lg: 2,
                  xl: 2,
                }}
                dataSource={novels}
                renderItem={(novel) => {
                  const entry = novelPrimaryHref(novel);
                  const ready = isNovelSetupComplete(novel);

                  return (
                    <List.Item>
                      <Card
                        hoverable
                        style={{
                          borderRadius: 16,
                          border: "none",
                          boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                          background: cardBg,
                          transition: "all 0.3s",
                        }}
                        bodyStyle={{ padding: "1.5rem" }}
                        actions={[
                          <Tooltip title={ready ? t("nav_write") : t("nav_settings")} key="edit">
                            <Link to={entry}>
                              <Button
                                type="text"
                                icon={<EditOutlined />}
                                style={{ color: "#cc785c" }}
                              >
                                {ready ? t("dashboard_write") : t("dashboard_setup")}
                              </Button>
                            </Link>
                          </Tooltip>,
                          <Tooltip title={t("dashboard_export_novel")} key="export">
                            <Button
                              type="text"
                              icon={<ExportOutlined />}
                              onClick={() => setExportNovel(novel)}
                              style={{ color: "#cc785c" }}
                            >
                              {t("dashboard_export_novel")}
                            </Button>
                          </Tooltip>,
                          <Tooltip title={t("dashboard_delete_novel")} key="delete">
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => showDeleteConfirm(novel)}
                            >
                              {t("dashboard_delete_novel")}
                            </Button>
                          </Tooltip>,
                        ]}
                      >
                        <Card.Meta
                          title={
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: "0.25rem",
                              }}
                            >
                              <Link
                                to={entry}
                                style={{
                                  fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                                  fontSize: "1.15rem",
                                  fontWeight: 600,
                                  color: textColor,
                                  textDecoration: "none",
                                  transition: "color 0.3s ease",
                                }}
                              >
                                {novel.title || t("dashboard_untitled")}
                              </Link>
                              {!ready && (
                                <Tag color="orange" icon={<QuestionCircleOutlined />}>
                                  {t("dashboard_incomplete")}
                                </Tag>
                              )}
                            </div>
                          }
                          description={
                            <div>
                              <div
                                style={{
                                  marginBottom: "0.5rem",
                                }}
                              >
                                <Space size="middle">
                                  <Text type="secondary" style={{ fontSize: "0.85rem", color: secondaryTextColor }}>
                                    {novel.genre ? t("dashboard_genre") + novel.genre : t("dashboard_no_genre")}
                                  </Text>
                                </Space>
                              </div>
                              <Text
                                type="secondary"
                                style={{
                                  fontSize: "0.8rem",
                                  color: secondaryTextColor,
                                  transition: "color 0.3s ease",
                                }}
                              >
                                {t("dashboard_created")}{new Date(novel.updated_at).toLocaleString()}
                              </Text>
                            </div>
                          }
                        />
                      </Card>
                    </List.Item>
                  );
                }}
              />
            </div>
          )}
        </Spin>
      </Content>

      {exportNovel && (
        <ExportNovelModal novel={exportNovel} onClose={() => setExportNovel(null)} />
      )}
    </Layout>
  );
}
