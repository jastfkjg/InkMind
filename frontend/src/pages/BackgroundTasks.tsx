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
  GlobalOutlined,
} from "@ant-design/icons";

import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useNavigation } from "@/context/NavigationContext";
import { useI18n } from "@/i18n";
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

interface TaskWithProgress extends BackgroundTask {
  progressData?: TaskProgress;
}

export default function BackgroundTasksPage() {
  const { user, logout } = useAuth();
  const { theme, setTheme, isDark, isSepia } = useTheme();
  const { t, setLanguage, isZh } = useI18n();
  const nav = useNavigate();
  const { goBackSmart } = useNavigation();
  const [tasks, setTasks] = useState<TaskWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selectedTask, setSelectedTask] = useState<TaskWithProgress | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const fmtTime = (iso: string | null) => {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(isZh ? "zh-CN" : "en-US");
  };

  const getStatusInfo = (status: string) => {
    const map: Record<string, { color: string; labelKey: string; icon: React.ReactNode }> = {
      pending: { color: "default", labelKey: "tasks_status_pending", icon: <ClockCircleOutlined /> },
      running: { color: "processing", labelKey: "tasks_status_running", icon: <PlayCircleOutlined spin /> },
      paused: { color: "warning", labelKey: "tasks_status_paused", icon: <PauseCircleOutlined /> },
      completed: { color: "success", labelKey: "tasks_status_completed", icon: <CheckCircleOutlined /> },
      failed: { color: "error", labelKey: "tasks_status_failed", icon: <CloseCircleOutlined /> },
      cancelled: { color: "default", labelKey: "tasks_status_cancelled", icon: <StopOutlined /> },
    };
    const info = map[status] || { color: "default", labelKey: status, icon: null };
    return { ...info, label: t(info.labelKey) };
  };

  const getTaskTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      single_chapter: "tasks_type_single",
      batch_chapters: "tasks_type_batch",
      rewrite_chapter: "tasks_type_rewrite",
      append_chapter: "tasks_type_append",
    };
    return map[type] ? t(map[type]) : type;
  };

  const getTaskTypeColor = (type: string) => {
    const map: Record<string, string> = {
      single_chapter: "blue",
      batch_chapters: "cyan",
      rewrite_chapter: "orange",
      append_chapter: "green",
    };
    return map[type] || "default";
  };

  const translateProgressMessage = (msg: string | null): string => {
    if (!msg) return "-";
    if (isZh) return msg;

    const patterns: Array<{ regex: RegExp; key: string; groups: string[] }> = [
      { regex: /^准备生成章节\.\.\.$/, key: "tasks_progress_preparing", groups: [] },
      { regex: /^正在规划批量章节\.\.\.$/, key: "tasks_progress_planning_batch", groups: [] },
      { regex: /^章节规划完成，开始逐章生成\.\.\.$/, key: "tasks_progress_planning_complete", groups: [] },
      { regex: /^用户或作品不存在$/, key: "tasks_error_user_novel_not_found", groups: [] },
      { regex: /^章节生成失败，未返回章节对象$/, key: "tasks_error_no_chapter_returned", groups: [] },
      { regex: /^章节生成失败$/, key: "tasks_error_generation_failed", groups: [] },
      { regex: /^章节「(.+?)」生成完成$/, key: "tasks_progress_chapter_completed", groups: ["title"] },
      { regex: /^任务已取消，已完成 (\d+) 章$/, key: "tasks_progress_cancelled", groups: ["count"] },
      { regex: /^正在生成第 (\d+)\/(\d+) 章：(.+)$/, key: "tasks_progress_generating", groups: ["idx", "total", "title"] },
      { regex: /^批量生成完成！成功生成 (\d+)\/(\d+) 章$/, key: "tasks_progress_batch_complete", groups: ["completed", "total"] },
      { regex: /^系统错误: (.+)$/, key: "tasks_error_system_error", groups: ["error"] },
    ];

    for (const { regex, key, groups } of patterns) {
      const match = msg.match(regex);
      if (match) {
        const params: Record<string, string> = {};
        groups.forEach((group, idx) => {
          params[group] = match[idx + 1] || "";
        });
        let translated = t(key);
        for (const [k, v] of Object.entries(params)) {
          translated = translated.replace(`{${k}}`, v);
        }
        return translated;
      }
    }

    return msg;
  };

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
      disabled: true,
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
      title: t("tasks_table_type"),
      dataIndex: "task_type" as const,
      key: "task_type",
      render: (type: string) => (
        <Tag color={getTaskTypeColor(type)}>{getTaskTypeLabel(type)}</Tag>
      ),
      width: 120,
    },
    {
      title: t("tasks_table_status"),
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
      title: t("tasks_table_progress"),
      key: "progress",
      render: (_: unknown, record: TaskWithProgress) => {
        if (record.batch_count > 1) {
          return (
            <Text type="secondary">
              {t("common_progress_chapters")
                .replace("{completed}", String(record.completed_count))
                .replace("{total}", String(record.batch_count))}
            </Text>
          );
        }
        return <Text type="secondary">-</Text>;
      },
      width: 100,
    },
    {
      title: t("tasks_table_progress_message"),
      dataIndex: "progress_message" as const,
      key: "progress_message",
      render: (msg: string | null, record: TaskWithProgress) => {
        if (record.status === "failed" && record.error_message) {
          return (
            <Tooltip title={translateProgressMessage(record.error_message)}>
              <Text type="danger" ellipsis style={{ maxWidth: 200 }}>
                {translateProgressMessage(record.error_message)}
              </Text>
            </Tooltip>
          );
        }
        return translateProgressMessage(msg);
      },
      width: 250,
    },
    {
      title: t("tasks_table_tokens"),
      dataIndex: "total_tokens" as const,
      key: "total_tokens",
      render: (n: number) => {
        if (n === 0) return <Text type="secondary">-</Text>;
        return (
          <Text strong style={{ fontFamily: "ui-monospace, monospace", color: primaryColor }}>
            {new Intl.NumberFormat(isZh ? "zh-CN" : "en-US").format(n)}
          </Text>
        );
      },
      width: 120,
    },
    {
      title: t("tasks_table_created"),
      dataIndex: "created_at" as const,
      key: "created_at",
      render: (time: string) => <Text type="secondary">{fmtTime(time)}</Text>,
      width: 180,
    },
    {
      title: t("tasks_table_actions"),
      key: "actions",
      render: (_: unknown, record: TaskWithProgress) => (
        <Space>
          <Button type="link" size="small" onClick={() => openDetail(record)}>
            {t("tasks_action_view")}
          </Button>
          {(record.status === "pending" || record.status === "running") && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => handleCancel(record.id)}
            >
              {t("tasks_action_cancel")}
            </Button>
          )}
          {record.status !== "pending" && record.status !== "running" && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => setConfirmDeleteId(record.id)}
            >
              {t("tasks_action_delete")}
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
            {t("nav_background_tasks")}
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
            {t("nav_back")}
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
            {t("common_refresh")}
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
            message={t("common_load_failed")}
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
                    {t("tasks_stat_running")}
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
                    {t("tasks_stat_completed")}
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
                    {t("tasks_stat_failed")}
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
                    {t("tasks_stat_total")}
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
                {t("tasks_list_title")}
              </Title>
              {runningCount > 0 && (
                <Tag color="processing">
                  {t("tasks_auto_refresh")}
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
                  {t("tasks_empty_full_desc")}
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
                  showTotal: (total) => t("tasks_total_records").replace("{total}", String(total)),
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
              {t("tasks_details_title")}
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
            {t("common_close")}
          </Button>,
        ]}
        width={700}
      >
        {selectedTask && (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  {t("tasks_details_id")}
                </Text>
                <br />
                <Text strong>{selectedTask.id}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  {t("tasks_details_status")}
                </Text>
                <br />
                <Tag color={getStatusInfo(selectedTask.status).color}>
                  {getStatusInfo(selectedTask.status).icon}{" "}
                  {getStatusInfo(selectedTask.status).label}
                </Tag>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  {t("tasks_details_created")}
                </Text>
                <br />
                <Text>{fmtTime(selectedTask.created_at)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  {t("tasks_details_started")}
                </Text>
                <br />
                <Text>{fmtTime(selectedTask.started_at)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  {t("tasks_details_completed")}
                </Text>
                <br />
                <Text>{fmtTime(selectedTask.completed_at)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  {t("tasks_details_tokens")}
                </Text>
                <br />
                <Text strong style={{ fontFamily: "ui-monospace, monospace" }}>
                  {selectedTask.total_tokens > 0
                    ? new Intl.NumberFormat(isZh ? "zh-CN" : "en-US").format(selectedTask.total_tokens)
                    : "-"}
                </Text>
              </Col>
            </Row>

            <div style={{ marginTop: "1.5rem" }}>
              <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                {t("tasks_details_summary_label")}
              </Text>
              <br />
              <Paragraph ellipsis={{ rows: 3 }} style={{ marginTop: "0.25rem" }}>
                {selectedTask.summary || "-"}
              </Paragraph>
            </div>

            {selectedTask.progress_message && (
              <div style={{ marginTop: "1rem" }}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  {t("tasks_details_progress_message")}
                </Text>
                <br />
                <Text style={{ marginTop: "0.25rem" }}>
                  {translateProgressMessage(selectedTask.progress_message)}
                </Text>
              </div>
            )}

            {selectedTask.error_message && (
              <Alert
                message={t("tasks_details_error")}
                description={translateProgressMessage(selectedTask.error_message)}
                type="error"
                showIcon
                style={{ marginTop: "1.5rem" }}
              />
            )}

            {selectedTask.batch_count > 1 && selectedTask.task_items && selectedTask.task_items.length > 0 && (
              <div style={{ marginTop: "1.5rem" }}>
                <Text type="secondary" style={{ fontSize: "0.85rem" }}>
                  {t("tasks_details_chapters_list")
                    .replace("{completed}", String(selectedTask.completed_count))
                    .replace("{total}", String(selectedTask.batch_count))}
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
                          <Text strong>{t("tasks_details_chapter_num").replace("{n}", String(idx + 1))}</Text>
                          <Tag color={getStatusInfo(item.status).color}>
                            {getStatusInfo(item.status).label}
                          </Tag>
                        </Space>
                      }
                    >
                      {item.generated_title && (
                        <div>
                          <Text type="secondary">{t("tasks_details_chapter_title_label")}</Text>
                          <Text strong>{item.generated_title}</Text>
                        </div>
                      )}
                      {item.summary && (
                        <div>
                          <Text type="secondary">{t("tasks_details_chapter_summary_label")}</Text>
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
        title={t("tasks_delete_confirm_title")}
        open={confirmDeleteId !== null}
        onOk={() => confirmDeleteId !== null && void handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
        okText={t("tasks_action_delete")}
        cancelText={t("common_cancel")}
        okButtonProps={{ danger: true }}
      >
        <Paragraph>
          {t("tasks_delete_confirm_content")}
        </Paragraph>
      </Modal>
    </Layout>
  );
}
