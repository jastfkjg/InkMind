import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Layout,
  Card,
  Typography,
  Button,
  Empty,
  Spin,
  Alert,
  Tag,
  Tooltip,
  message,
  Modal,
  Input,
  Select,
  Dropdown,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  ExportOutlined,
  DeleteOutlined,
  BookOutlined,
  MoreOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  apiErrorMessage,
  createNovel,
  deleteNovel,
  fetchNovels,
} from "@/api/client";
import AppHeader, { useHeaderTheme } from "@/components/AppHeader";
import ExportNovelModal from "@/components/ExportNovelModal";
import { QuotaWarning } from "@/components/QuotaWarning";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
import type { Novel, NovelListItem } from "@/types";
import { novelPrimaryHref } from "@/utils/novelSetup";
import { readPosition, sessionKey } from "@/utils/writeSession";
import { relativeEditTime } from "@/utils/relativeTime";

const { Content } = Layout;
const { Title, Text } = Typography;
const { confirm } = Modal;

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { t, language } = useI18n();
  const colors = useHeaderTheme();
  const [novels, setNovels] = useState<NovelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [exportNovel, setExportNovel] = useState<Novel | null>(null);
  const nav = useNavigate();
  const [view, setView] = useState<"grid" | "list">(() => {
    try { return localStorage.getItem("inkmind_library_view") === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  useEffect(() => { try { localStorage.setItem("inkmind_library_view", view); } catch { /* optional preference */ } }, [view]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const visibleNovels = useMemo(() => novels
    .filter((novel) => `${novel.title} ${novel.genre}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : Date.parse(b.last_edited_at || b.updated_at) - Date.parse(a.last_edited_at || a.updated_at)), [novels, query, sort]);

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
      const n = await createNovel({ title: t("dashboard_untitled"), create_first_chapter: true });
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

  return (
    <Layout className="dashboard-layout" style={{ minHeight: "100vh", background: colors.bgColor }}>
      <AppHeader
        leftContent={<div className="library-brand"><BookOutlined /><Title level={3}>{t("app_name")}</Title></div>}
        onLogout={logout}
      />
      <Content className="dashboard-content library-content">
        {err && <Alert message={t("operation_failed_title")} description={err} type="error" showIcon />}
        <QuotaWarning />
        <div className="library-heading">
          <div><Title level={4}>{t("dashboard_title")}</Title><Text type="secondary">{t("library_count").replace("{count}", String(novels.length))}</Text></div>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate} loading={creating}>{t("dashboard_create_novel")}</Button>
        </div>
        <div className="dashboard-controls">
          <Input.Search allowClear value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("dashboard_search")} aria-label={t("dashboard_search")} />
          <Select value={sort} onChange={setSort} aria-label={t("dashboard_sort")} options={[
            { value: "recent", label: t("dashboard_sort_recent") }, { value: "title", label: t("dashboard_sort_title") },
          ]} />
          <div className="library-view-switch" role="group" aria-label={t("library_view")}>
            <Button icon={<AppstoreOutlined />} aria-label={t("library_grid")} aria-pressed={view === "grid"} type={view === "grid" ? "primary" : "text"} onClick={() => setView("grid")} />
            <Button icon={<UnorderedListOutlined />} aria-label={t("library_list")} aria-pressed={view === "list"} type={view === "list" ? "primary" : "text"} onClick={() => setView("list")} />
          </div>
        </div>
        <Spin spinning={loading}>
          {!loading && novels.length === 0 ? (
            <div className="library-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><Title level={4}>{t("dashboard_no_novels")}</Title><p>{t("library_empty_hint")}</p></>} />
              <Button type="primary" onClick={onCreate} loading={creating}>{t("dashboard_create_novel")}</Button>
            </div>
          ) : visibleNovels.length === 0 && !loading ? <Empty description={t("write_search_empty")} /> : (
            <div className={`library-items library-items--${view}`}>
              {visibleNovels.map((novel) => {
                const position = user ? readPosition(localStorage, sessionKey(user.id, novel.id)) : null;
                const chapterId = position?.chapterId ?? novel.last_chapter_id;
                const entry = novelPrimaryHref(novel) + (chapterId ? `?chapter=${chapterId}` : "");
                const edited = novel.last_edited_at || novel.updated_at;
                return (
                  <Card key={novel.id} className="library-item" size="small">
                    <div className="library-item__main">
                      <div className="library-item__title">
                        <Link to={entry}>{novel.title || t("dashboard_untitled")}</Link>
                        {novel.genre && <Tag>{novel.genre}</Tag>}
                      </div>
                      <div className="library-item__progress">
                        <span>{t("library_words").replace("{count}", (novel.total_words ?? 0).toLocaleString(language))}</span>
                        <span>{t("library_chapters").replace("{count}", String(novel.chapter_count ?? 0))}</span>
                      </div>
                      <p className="library-item__chapter" title={novel.last_chapter_title || undefined}>
                        {novel.last_chapter_id ? t("library_last_chapter").replace("{title}", novel.last_chapter_title || t("write_chapter_title_placeholder")) : t("library_ready_to_write")}
                      </p>
                      <Tooltip title={new Date(edited).toLocaleString(language)}><time dateTime={edited}>{t("dashboard_updated")}{relativeEditTime(edited, language)}</time></Tooltip>
                    </div>
                    <div className="library-item__actions">
                      <Link to={entry} className="library-continue"><EditOutlined />{t("dashboard_write")}</Link>
                      <Dropdown trigger={["click"]} menu={{ items: [
                        { key: "settings", icon: <SettingOutlined />, label: t("nav_settings"), onClick: () => nav(`/novels/${novel.id}/settings`) },
                        { key: "export", icon: <ExportOutlined />, label: t("dashboard_export_novel"), onClick: () => setExportNovel(novel) },
                        { key: "delete", icon: <DeleteOutlined />, label: t("dashboard_delete_novel"), danger: true, onClick: () => showDeleteConfirm(novel) },
                      ] }}>
                        <Button type="text" icon={<MoreOutlined />} aria-label={`${novel.title} · ${t("dashboard_more")}`} />
                      </Dropdown>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Spin>
      </Content>
      {exportNovel && <ExportNovelModal novel={exportNovel} onClose={() => setExportNovel(null)} />}
    </Layout>
  );
}
