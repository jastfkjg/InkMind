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
} from "@ant-design/icons";
import {
  apiErrorMessage,
  createNovel,
  deleteNovel,
  fetchNovels,
} from "@/api/client";
import ExportNovelModal from "@/components/ExportNovelModal";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import type { Novel } from "@/types";
import { isNovelSetupComplete, novelPrimaryHref } from "@/utils/novelSetup";

const { Header, Content } = Layout;
const { Title, Text } = Typography;
const { confirm } = Modal;

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { theme, setTheme, isDark, isSepia } = useTheme();
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
      const n = await createNovel({ title: "未命名作品" });
      setNovels((prev) => [n, ...prev]);
      message.success("作品创建成功！");
      nav(novelPrimaryHref(n));
    } catch (e) {
      setErr(apiErrorMessage(e));
      message.error("创建失败");
    } finally {
      setCreating(false);
    }
  }

  function showDeleteConfirm(novel: Novel) {
    confirm({
      title: "删除作品",
      content: `确定要删除《${novel.title || "未命名"}》吗？此操作不可恢复。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      async onOk() {
        try {
          await deleteNovel(novel.id);
          setNovels((prev) => prev.filter((x) => x.id !== novel.id));
          message.success("作品已删除");
        } catch (e) {
          setErr(apiErrorMessage(e));
          message.error("删除失败");
        }
      },
    });
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
        message.success("已退出登录");
      },
    },
  ];

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
  const cardBg = isDark ? "#16213e" : isSepia ? "#faf6e9" : "#fffcf7";
  const secondaryTextColor = isDark ? "#9ca3af" : isSepia ? "#8b7355" : "#57534e";

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
              color: isDark ? "#f97316" : "#7c2d12",
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
            InkMind
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
            新建作品
          </Button>

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
                  background: isDark ? "#f97316" : "#7c2d12",
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
            message="操作失败"
            description={err}
            type="error"
            showIcon
            style={{ marginBottom: "1.5rem" }}
          />
        )}

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
                      还没有作品
                    </Title>
                    <Text type="secondary">点击「新建作品」开始你的创作之旅</Text>
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
                我的作品 ({novels.length})
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
                          <Tooltip title={ready ? "开始写作" : "完善设定"} key="edit">
                            <Link to={entry}>
                              <Button
                                type="text"
                                icon={<EditOutlined />}
                                style={{ color: isDark ? "#f97316" : "#7c2d12" }}
                              >
                                {ready ? "写作" : "设定"}
                              </Button>
                            </Link>
                          </Tooltip>,
                          <Tooltip title="导出作品" key="export">
                            <Button
                              type="text"
                              icon={<ExportOutlined />}
                              onClick={() => setExportNovel(novel)}
                              style={{ color: isDark ? "#f97316" : "#7c2d12" }}
                            >
                              导出
                            </Button>
                          </Tooltip>,
                          <Tooltip title="删除作品" key="delete">
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => showDeleteConfirm(novel)}
                            >
                              删除
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
                                {novel.title || "未命名作品"}
                              </Link>
                              {!ready && (
                                <Tag color="orange" icon={<QuestionCircleOutlined />}>
                                  待完善
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
                                    {novel.genre ? `类型：${novel.genre}` : "未设置类型"}
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
                                最后更新：{new Date(novel.updated_at).toLocaleString()}
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
