import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Layout,
  Card,
  Table,
  Button,
  Space,
  Typography,
  Spin,
  Alert,
  Statistic,
  Row,
  Col,
  Tag,
  Dropdown,
  Avatar,
  Modal,
  Progress,
  Tooltip,
  Badge,
} from "antd";
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  StopOutlined,
  LogoutOutlined,
  BarChartOutlined,
  SunOutlined,
  MoonOutlined,
  EyeOutlined,
  UserOutlined,
  SettingOutlined,
  HistoryOutlined,
} from "@ant-design/icons";

import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useNavigation } from "@/context/NavigationContext";
import { 
  apiErrorMessage, 
  fetchBackgroundTasks, 
  fetchTaskProgress,
  cancelBackgroundTask,
  deleteBackgroundTask,
} from "@/api/client";
import type { BackgroundTask, TaskProgress } from "@/types";

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

function fmtTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function getStatusInfo(status: string) {
  const map: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    pending: { color: "default", label: "等待中", icon: <ClockCircleOutlined /> },
    running: { color: "processing", label: "运行中", icon: <PlayCircleOutlined spin /> },
    paused: { color: "warning", label: "已暂停", icon: <PauseCircleOutlined /> },
    completed: { color: "success", label: "已完成", icon: <CheckCircleOutlined /> },
    failed: { color: "error", label: "失败", icon: <CloseCircleOutlined /> },
    cancelled: { color: "default", label: "已取消", icon: <StopOutlined /> },
  };
  return map[status] || { color: "default", label: status, icon: null };
}

function getTaskTypeLabel(type: string) {
  const map: Record<string, string> = {
    single_chapter: "单章节",
    batch_chapters: "批量章节",
    rewrite_chapter: "改写章节",
    append_chapter: "追加章节",
  };
  return map[type] || type;
}

function getTaskTypeColor(type: string) {
  const map: Record<string, string> = {
    single_chapter: "blue",
    batch_chapters: "cyan",
    rewrite_chapter: "orange",
    append_chapter: "green",
  };
  return map[type] || "default";
}

interface TaskWithProgress extends BackgroundTask {
  progressData?: TaskProgress;
}

export default function BackgroundTasksPage() {
  const { user, logout } = useAuth();
  const { theme, setTheme, isDark, isSepia } = useTheme();
  const nav = useNavigate();
  const { goBackSmart } = useNavigation();
  const [tasks, setTasks] = useState<TaskWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selectedTask, setSelectedTask] = useState<TaskWithProgress | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const loadTasks = useCallback(async () => {
    setErr("");
    try {
      const r = await fetchBackgroundTasks({ limit: 50 });
      
      const tasksWithProgress: TaskWithProgress[] = await Promise.all(
        r.map(async (task) => {
          if (task.status === "pending" || task.status === "running") {
            try {
              const progress = await fetchTaskProgress(task.id);
              return { ...task, progressData: progress };
            } catch {
              return task;
            }
          }
          return task;
        })
      );
      
      setTasks(tasksWithProgress);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    
    const interval = setInterval(() => {
      void loadTasks();
    }, 3000);
    
    return () => clearInterval(interval);
  }, [loadTasks]);

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
      key: "settings",
      icon: <SettingOutlined />,
      label: "AI 设置",
      onClick: () => nav("/settings"),
    },
    {
      key: "usage",
      icon: <BarChartOutlined />,
      label: "Token 用量",
      onClick: () => nav("/usage"),
    },
    {
      key: "tasks",
      icon: <HistoryOutlined />,
      label: "后台任务",
      disabled: true,
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
      onClick: () => logout(),
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
  const primaryColor = isDark ? "#f97316" : "#7c2d12";
  const secondaryTextColor = isDark ? "#9ca3af" : isSepia ? "#8b7355" : "#57534e";

  const getThemeIcon = () => {
    if (theme === "dark") return <MoonOutlined />;
    if (theme === "sepia") return <EyeOutlined />;
    return <SunOutlined />;
  };

  const handleCancel = async (taskId: number) => {
    try {
      await cancelBackgroundTask(taskId);
      void loadTasks();
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  };

  const handleDelete = async (taskId: number) => {
    try {
      await deleteBackgroundTask(taskId);
      setConfirmDeleteId(null);
      void loadTasks();
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  };

  const openDetail = (task: TaskWithProgress) => {
    setSelectedTask(task);
    setDetailModalOpen(true);
  };

  const runningCount = tasks.filter((t) => t.status === "running" || t.status === "pending").length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;

  const columns = [
    {
      title: "任务类型",
      dataIndex: "task_type" as const,
      key: "task_type",
      render: (type: string) => (
        <Tag color={getTaskTypeColor(type)}>{getTaskTypeLabel(type)}</Tag>
      ),
      width: 120,
    },
    {
      title: "状态",
      dataIndex: "status" as const,
      key: "status",
      render: (status: string, record: TaskWithProgress) => {
        const info = getStatusInfo(status);
        const progress = record.progressData?.progress ?? 0;
        
        if (status === "running" && progress > 0) {
          return (
            <Space direction="vertical" size="small" style={{ width: 160 }}>
              <Tag color={info.color}>
                {info.icon} {info.label}
              </Tag>
              <Progress percent={Math.round(progress)} size="small" />
            </Space>
          );
        }
        
        return (
          <Tag color={info.color}>
            {info.icon} {info.label}
          </Tag>
        );
      },
      width: 180,
    },
    {
      title: "进度",
      key: "progress",
      render: (_: unknown, record: TaskWithProgress) => {
        if (record.batch_count > 1) {
          return (
            <Text type="secondary">
              {record.completed_count} / {record.batch_count} 章
            </Text>
          );
        }
        return <Text type="secondary">-</Text>;
      },
      width: 100,
    },
    {
      title: "进度消息",
      dataIndex: "progress_message" as const,
      key: "progress_message",
      render: (msg: string | null, record: TaskWithProgress) => {
        if (record.status === "failed" && record.error_message) {
          return (
            <Tooltip title={record.error_message}>
              <Text type="danger" ellipsis style={{ maxWidth: 200 }}>
                {record.error_message}
              </Text>
            </Tooltip>
          );
        }
        return msg || "-";
      },
      width: 250,
    },
    {
      title: "Token 消耗",
      dataIndex: "total_tokens" as const,
      key: "total_tokens",
      render: (n: number) => {
        if (n === 0) return <Text type="secondary">-</Text>;
        return (
          <Text strong style={{ fontFamily: "ui-monospace, monospace", color: primaryColor }}>
            {new Intl.NumberFormat("zh-CN").format(n)}
          </Text>
        );
      },
      width: 120,
    },
    {
      title: "创建时间",
      dataIndex: "created_at" as const,
      key: "created_at",
      render: (time: string) => <Text type="secondary">{fmtTime(time)}</Text>,
      width: 180,
    },
    {
      title: "操作",
      key: "actions",
      render: (_: unknown, record: TaskWithProgress) => (
        <Space>
          <Button type="link" size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          {(record.status === "pending" || record.status === "running") && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => handleCancel(record.id)}
            >
              取消
            </Button>
          )}
          {record.status !== "pending" && record.status !== "running" && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => setConfirmDeleteId(record.id)}
            >
              删除
            </Button>
          )}
        </Space>
      ),
      width: 180,
    },
  ];

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
          <HistoryOutlined
            style={{
              fontSize: "1.75rem",
              color: primaryColor,
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
            后台任务
          </Title>
          {runningCount > 0 && (
            <Badge count={runningCount} showZero>
              <div />
            </Badge>
          )}
        </div>

        <Space size="middle">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => goBackSmart()}
            size="large"
            style={{ height: 40 }}
          >
            返回
          </Button>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={() => {
              setLoading(true);
              void loadTasks();
            }}
            loading={loading}
            size="large"
            style={{ height: 40 }}
          >
            刷新
          </Button>

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
              <Text strong style={{ color: textColor, transition: "color 0.3s ease" }}>
                {user?.display_name || user?.email}
              </Text>
            </div>
          </Dropdown>
        </Space>
      </Header>

      <Content
        style={{
          padding: "2rem",
          maxWidth: 1400,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {err && (
          <Alert
            message="加载失败"
            description={err}
            type="error"
            showIcon
            closable
            onClose={() => setErr("")}
            style={{ marginBottom: "1.5rem" }}
          />
        )}

        <Row gutter={[24, 24]} style={{ marginBottom: "1.5rem" }}>
          <Col xs={24} sm={6}>
            <Card
              style={{
                borderRadius: 16,
                border: "none",
                boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                background: cardBg,
                transition: "background-color 0.3s ease, box-shadow 0.3s ease",
              }}
            >
              <Statistic
                title={
                  <Text type="secondary" style={{ fontSize: "0.9rem", color: secondaryTextColor }}>
                    运行中
                  </Text>
                }
                value={runningCount}
                valueStyle={{ color: "#1677ff", fontFamily: "ui-monospace, monospace" }}
                prefix={<PlayCircleOutlined spin />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={6}>
            <Card
              style={{
                borderRadius: 16,
                border: "none",
                boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                background: cardBg,
                transition: "background-color 0.3s ease, box-shadow 0.3s ease",
              }}
            >
              <Statistic
                title={
                  <Text type="secondary" style={{ fontSize: "0.9rem", color: secondaryTextColor }}>
                    已完成
                  </Text>
                }
                value={completedCount}
                valueStyle={{ color: "#52c41a", fontFamily: "ui-monospace, monospace" }}
                prefix={<CheckCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={6}>
            <Card
              style={{
                borderRadius: 16,
                border: "none",
                boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                background: cardBg,
                transition: "background-color 0.3s ease, box-shadow 0.3s ease",
              }}
            >
              <Statistic
                title={
                  <Text type="secondary" style={{ fontSize: "0.9rem", color: secondaryTextColor }}>
                    失败
                  </Text>
                }
                value={failedCount}
                valueStyle={{ color: "#ff4d4f", fontFamily: "ui-monospace, monospace" }}
                prefix={<CloseCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={6}>
            <Card
              style={{
                borderRadius: 16,
                border: "none",
                boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
                background: cardBg,
                transition: "background-color 0.3s ease, box-shadow 0.3s ease",
              }}
            >
              <Statistic
                title={
                  <Text type="secondary" style={{ fontSize: "0.9rem", color: secondaryTextColor }}>
                    总任务数
                  </Text>
                }
                value={tasks.length}
                valueStyle={{ color: primaryColor, fontFamily: "ui-monospace, monospace" }}
                prefix={<HistoryOutlined />}
              />
            </Card>
          </Col>
        </Row>

        <Card
          style={{
            borderRadius: 16,
            border: "none",
            boxShadow: isDark ? "0 4px 6px rgba(0, 0, 0, 0.3)" : "0 4px 6px rgba(28, 25, 23, 0.06)",
            background: cardBg,
            transition: "background-color 0.3s ease, box-shadow 0.3s ease",
          }}
          title={
            <Space>
              <Title
                level={4}
                style={{
                  margin: 0,
                  fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                  color: textColor,
                  transition: "color 0.3s ease",
                }}
              >
                任务列表
              </Title>
              {runningCount > 0 && (
                <Tag color="processing">
                  每 3 秒自动刷新
                </Tag>
              )}
            </Space>
          }
        >
          <Spin spinning={loading}>
            {!loading && tasks.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "4rem 2rem",
                }}
              >
                <Text
                  type="secondary"
                  style={{
                    fontSize: "1rem",
                    color: secondaryTextColor,
                  }}
                >
                  暂无后台任务。在写作页面选择「后台写作」模式即可创建任务。
                </Text>
              </div>
            ) : (
              <Table
                columns={columns}
                dataSource={tasks}
                rowKey="id"
                pagination={{
                  pageSize: 20,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条记录`,
                  pageSizeOptions: ["10", "20", "50"],
                }}
                scroll={{ x: 1100 }}
              />
            )}
          </Spin>
        </Card>
      </Content>

      <Modal
        title={
          <Space>
            <Title level={4} style={{ margin: 0 }}>
              任务详情
            </Title>
            {selectedTask && (
              <Tag color={getStatusInfo(selectedTask.status).color}>
                {getTaskTypeLabel(selectedTask.task_type)}
              </Tag>
            )}
          </Space>
        }
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalOpen(false)}>
            关闭
          </Button>,
        ]}
        width={700}
      >
        {selectedTask && (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  任务 ID
                </Text>
                <br />
                <Text strong>{selectedTask.id}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  状态
                </Text>
                <br />
                <Tag color={getStatusInfo(selectedTask.status).color}>
                  {getStatusInfo(selectedTask.status).icon}{" "}
                  {getStatusInfo(selectedTask.status).label}
                </Tag>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  创建时间
                </Text>
                <br />
                <Text>{fmtTime(selectedTask.created_at)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  开始时间
                </Text>
                <br />
                <Text>{fmtTime(selectedTask.started_at)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  完成时间
                </Text>
                <br />
                <Text>{fmtTime(selectedTask.completed_at)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  消耗 Token
                </Text>
                <br />
                <Text strong style={{ fontFamily: "ui-monospace, monospace" }}>
                  {selectedTask.total_tokens > 0
                    ? new Intl.NumberFormat("zh-CN").format(selectedTask.total_tokens)
                    : "-"}
                </Text>
              </Col>
            </Row>

            <div style={{ marginTop: "1.5rem" }}>
              <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                概要
              </Text>
              <br />
              <Paragraph ellipsis={{ rows: 3 }} style={{ marginTop: "0.25rem" }}>
                {selectedTask.summary || "-"}
              </Paragraph>
            </div>

            {selectedTask.progress_message && (
              <div style={{ marginTop: "1rem" }}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  进度消息
                </Text>
                <br />
                <Text style={{ marginTop: "0.25rem" }}>
                  {selectedTask.progress_message}
                </Text>
              </div>
            )}

            {selectedTask.error_message && (
              <Alert
                message="错误信息"
                description={selectedTask.error_message}
                type="error"
                showIcon
                style={{ marginTop: "1.5rem" }}
              />
            )}

            {selectedTask.batch_count > 1 && selectedTask.task_items && selectedTask.task_items.length > 0 && (
              <div style={{ marginTop: "1.5rem" }}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  章节列表 ({selectedTask.completed_count}/{selectedTask.batch_count})
                </Text>
                <div
                  style={{
                    marginTop: "0.5rem",
                    maxHeight: 300,
                    overflow: "auto",
                  }}
                >
                  {selectedTask.task_items.map((item, idx) => (
                    <Card
                      key={item.id}
                      size="small"
                      style={{ marginBottom: "0.5rem" }}
                      title={
                        <Space>
                          <Text strong>第 {idx + 1} 章</Text>
                          <Tag color={getStatusInfo(item.status).color}>
                            {getStatusInfo(item.status).label}
                          </Tag>
                        </Space>
                      }
                    >
                      {item.generated_title && (
                        <div>
                          <Text type="secondary">标题：</Text>
                          <Text strong>{item.generated_title}</Text>
                        </div>
                      )}
                      {item.summary && (
                        <div>
                          <Text type="secondary">概要：</Text>
                          <Text ellipsis>{item.summary}</Text>
                        </div>
                      )}
                      {item.error_message && (
                        <Alert
                          message={item.error_message}
                          type="error"
                          showIcon
                          style={{ marginTop: "0.5rem" }}
                        />
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title="确认删除"
        open={confirmDeleteId !== null}
        onOk={() => confirmDeleteId !== null && void handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <Paragraph>
          确定要删除这个后台任务吗？此操作不可恢复。
        </Paragraph>
      </Modal>
    </Layout>
  );
}
