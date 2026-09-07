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
  PushpinOutlined,
  PushpinFilled,
  InboxOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  apiErrorMessage,
  createNovel,
  deleteNovel,
  fetchNovels,
  updateNovel,
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
import "@/styles/library-organize.css";

const { Content } = Layout;
const { Title, Text } = Typography;

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { t, language } = useI18n();
  const colors = useHeaderTheme();
  const [novels, setNovels] = useState<NovelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [organizing, setOrganizing] = useState<Set<number>>(new Set());
  const [scope, setScope] = useState<"active" | "archived">("active");
  const [modal, modalContextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [exportNovel, setExportNovel] = useState<Novel | null>(null);
  const nav = useNavigate();
  const [view, setView] = useState<"grid" | "list">(() => {
    try { return localStorage.getItem("inkmind_library_view") === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  useEffect(() => { try { localStorage.setItem("inkmind_library_view", view); } catch { /* optional preference */ } }, [view]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const activeNovels = useMemo(() => novels.filter((novel) => !novel.is_archived), [novels]);
  const archivedCount = novels.length - activeNovels.length;
  const recentNovel = useMemo(() => activeNovels
    .filter((novel) => novel.chapter_count > 0)
    .sort((a, b) => Date.parse(b.last_edited_at || b.updated_at) - Date.parse(a.last_edited_at || a.updated_at))[0], [activeNovels]);
  const visibleNovels = useMemo(() => novels
    .filter((novel) => Boolean(novel.is_archived) === (scope === "archived"))
    .filter((novel) => `${novel.title} ${novel.genre}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) ||
      (sort === "title" ? a.title.localeCompare(b.title) : Date.parse(b.last_edited_at || b.updated_at) - Date.parse(a.last_edited_at || a.updated_at))), [novels, query, sort, scope]);

  function writingEntry(novel: NovelListItem): string {
    const position = user ? readPosition(localStorage, sessionKey(user.id, novel.id)) : null;
    const chapterId = position?.chapterId ?? novel.last_chapter_id;
    return novelPrimaryHref(novel) + (chapterId ? `?chapter=${chapterId}` : "");
  }

  async function organize(novel: NovelListItem, change: { is_pinned?: boolean; is_archived?: boolean }) {
    if (organizing.has(novel.id)) return;
    setOrganizing((previous) => new Set(previous).add(novel.id));
    setErr("");
    try {
      const updated = await updateNovel(novel.id, change);
      setNovels((previous) => previous.map((item) => item.id === novel.id ? { ...item, ...updated } : item));
      messageApi.success(t(change.is_archived === true ? "library_organized_archived" :
        change.is_archived === false ? "library_organized_restored" :
        change.is_pinned ? "library_organized_pinned" : "library_organized_unpinned"));
    } catch (error) {
      setErr(apiErrorMessage(error));
      messageApi.error(t("operation_failed_title"));
    } finally {
      setOrganizing((previous) => { const next = new Set(previous); next.delete(novel.id); return next; });
    }
  }

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
      messageApi.success(t("create_novel_success"));
      nav(novelPrimaryHref(n));
    } catch (e) {
      setErr(apiErrorMessage(e));
      messageApi.error(t("dashboard_create_failed"));
    } finally {
      setCreating(false);
    }
  }

  function showDeleteConfirm(novel: Novel) {
    modal.confirm({
      title: t("dashboard_delete_confirm_title"),
      content: t("dashboard_delete_confirm_content").replace("{title}", novel.title || t("dashboard_untitled")),
      okText: t("dashboard_yes_delete"),
      okType: "danger",
      cancelText: t("common_cancel"),
      async onOk() {
        try {
          await deleteNovel(novel.id);
          setNovels((prev) => prev.filter((x) => x.id !== novel.id));
          messageApi.success(t("dashboard_delete_success"));
        } catch (e) {
          setErr(apiErrorMessage(e));
          messageApi.error(t("dashboard_delete_failed"));
        }
      },
    });
  }

  return (
    <Layout className="dashboard-layout" style={{ minHeight: "100vh", background: colors.bgColor }}>
      {modalContextHolder}
      {messageContextHolder}
      <AppHeader
        leftContent={<div className="library-brand"><BookOutlined /><Title level={3}>{t("app_name")}</Title></div>}
        onLogout={logout}
      />
      <Content className="dashboard-content library-content">
        {err && <Alert message={t("operation_failed_title")} description={err} type="error" showIcon />}
        <QuotaWarning />
        <div className="library-heading">
          <div><Title level={4}>{t("dashboard_title")}</Title><Text type="secondary">{t("library_count").replace("{count}", String(scope === "archived" ? archivedCount : activeNovels.length))}</Text></div>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate} loading={creating}>{t("dashboard_create_novel")}</Button>
        </div>
        {!loading && scope === "active" && !query.trim() && recentNovel && (
          <section className="library-recent" aria-label={t("library_recent_continue")}>
            <div className="library-recent__label"><EditOutlined aria-hidden="true" />{t("library_recent_continue")}</div>
            <div className="library-recent__main">
              <Link to={writingEntry(recentNovel)}>{recentNovel.title || t("dashboard_untitled")}</Link>
              <p>{recentNovel.last_chapter_title || t("write_chapter_title_placeholder")}<span aria-hidden="true"> · </span>{relativeEditTime(recentNovel.last_edited_at || recentNovel.updated_at, language)}</p>
            </div>
            <Button onClick={() => nav(writingEntry(recentNovel))}>{t("dashboard_write")}</Button>
          </section>
        )}
        <div className="library-scope-tabs" role="group" aria-label={t("library_organization")}>
          <Button type="text" aria-pressed={scope === "active"} onClick={() => setScope("active")}>{t("library_active")}<span>{activeNovels.length}</span></Button>
          <Button type="text" aria-pressed={scope === "archived"} onClick={() => setScope("archived")}>{t("library_archived")}<span>{archivedCount}</span></Button>
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
        {scope === "archived" && <p className="library-archive-hint"><InboxOutlined aria-hidden="true" />{t("library_archive_hint")}</p>}
        <Spin spinning={loading}>
          {!loading && novels.length === 0 ? (
            <div className="library-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><Title level={4}>{t("dashboard_no_novels")}</Title><p>{t("library_empty_hint")}</p></>} />
              <Button type="primary" onClick={onCreate} loading={creating}>{t("dashboard_create_novel")}</Button>
            </div>
          ) : visibleNovels.length === 0 && !loading ? (
            <div className="library-organized-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query.trim() ? t("write_search_empty") : t(scope === "archived" ? "library_archive_empty" : "library_active_empty")} />
              {!query.trim() && scope === "active" && archivedCount > 0 && <Button onClick={() => setScope("archived")}>{t("library_view_archived")}</Button>}
            </div>
          ) : (
            <div className={`library-items library-items--${view}`}>
              {visibleNovels.map((novel) => {
                const entry = writingEntry(novel);
                const edited = novel.last_edited_at || novel.updated_at;
                return (
                  <Card key={novel.id} className="library-item" size="small">
                    <div className="library-item__main">
                      <div className="library-item__title">
                        <Link to={entry}>{novel.title || t("dashboard_untitled")}</Link>
                        <span className="library-item__flags">
                          {novel.is_pinned && <Tooltip title={t("library_pinned")}><PushpinFilled role="img" aria-label={t("library_pinned")} className="library-item__pin" /></Tooltip>}
                          {novel.genre && <Tag title={novel.genre}>{novel.genre}</Tag>}
                        </span>
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
                        { key: "pin", icon: novel.is_pinned ? <PushpinFilled /> : <PushpinOutlined />, label: t(novel.is_pinned ? "library_unpin" : "library_pin"), disabled: organizing.has(novel.id), onClick: () => organize(novel, { is_pinned: !novel.is_pinned }) },
                        { key: "archive", icon: novel.is_archived ? <UndoOutlined /> : <InboxOutlined />, label: t(novel.is_archived ? "library_restore" : "library_archive"), disabled: organizing.has(novel.id), onClick: () => organize(novel, { is_archived: !novel.is_archived }) },
                        { type: "divider" },
                        { key: "settings", icon: <SettingOutlined />, label: t("nav_settings"), onClick: () => nav(`/novels/${novel.id}/settings`) },
                        { key: "export", icon: <ExportOutlined />, label: t("dashboard_export_novel"), onClick: () => setExportNovel(novel) },
                        { key: "delete", icon: <DeleteOutlined />, label: t("dashboard_delete_novel"), danger: true, onClick: () => showDeleteConfirm(novel) },
                      ] }}>
                        <Button type="text" icon={<MoreOutlined />} loading={organizing.has(novel.id)} disabled={organizing.has(novel.id)} aria-label={`${novel.title} · ${t("dashboard_more")}`} />
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
