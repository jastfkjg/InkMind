import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  App as AntApp,
  Layout,
  Tabs,
  Button,
  Alert,
  Dropdown,
  Space,
} from "antd";
import {
  DownOutlined,
  ArrowLeftOutlined,
  SettingOutlined,
  EditOutlined,
  TeamOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { apiErrorMessage, fetchNovel, fetchNovels } from "@/api/client";
import AppHeader, { useHeaderTheme } from "@/components/AppHeader";
import { useI18n } from "@/i18n";
import "@/styles/workspace-polish.css";
import type { Novel } from "@/types";

const { Content } = Layout;

export default function NovelLayout() {
  const { novelId } = useParams();
  const id = Number(novelId);
  const nav = useNavigate();
  const loc = useLocation();
  const { t } = useI18n();
  const colors = useHeaderTheme();

  const peopleTabActive = loc.pathname.startsWith(`/novels/${id}/people`);
  const memosTabActive = loc.pathname.startsWith(`/novels/${id}/memos`);
  const writeTabActive = loc.pathname.includes("/write");
  const [novel, setNovel] = useState<Novel | null>(null);
  const [err, setErr] = useState("");
  const [works, setWorks] = useState<Novel[]>([]);
  const loadWorks = async () => {
    try { setWorks(await fetchNovels()); } catch (e) { setErr(apiErrorMessage(e)); }
  };

  useEffect(() => {
    if (!Number.isFinite(id)) {
      nav("/", { replace: true });
      return;
    }
    let active = true;
    setErr("");
    setNovel(null);
    (async () => {
      try {
        const n = await fetchNovel(id);
        if (active) setNovel(n);
      } catch (e) {
        if (active) setErr(apiErrorMessage(e));
      }
    })();
    return () => { active = false; };
  }, [id, nav]);

  if (!Number.isFinite(id)) {
    return null;
  }

  const tabItems = [
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
      key: "settings",
      label: (
        <Space>
          <SettingOutlined />
          <span>{t("novel_tab_settings")}</span>
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

  const bgColor = colors.bgColor;
  const bgLinear = colors.bgLinear;
  const bgRadial = colors.bgRadial;

  return (
    <Layout
      className="novel-layout"
      style={{
        minHeight: "100vh",
        background: bgColor,
        backgroundImage: bgRadial ? `${bgRadial}, ${bgLinear}` : bgLinear,
        transition: "background-color 0.3s ease",
      }}
    >
      <AppHeader
        height={64}
        padding="0 1.5rem"
        headerStyle={{ flexWrap: "wrap", gap: "1rem" }}
        leftContent={
          <div className="novel-header__content">
            <Button className="novel-header__back" aria-label={t("workspace_library")} type="text" icon={<ArrowLeftOutlined />} onClick={() => nav("/")} size="large">
              {t("workspace_library")}
            </Button>
            {novel && (
              <Dropdown trigger={["click"]} onOpenChange={(open) => { if (open) void loadWorks(); }} menu={{
                selectedKeys: [String(id)],
                items: (works.length ? works : [novel]).filter((work) => !work.is_archived || work.id === id).map((work) => ({ key: String(work.id), label: work.title || t("novel_untitled") })),
                onClick: ({ key }) => { if (Number(key) !== id) nav(`/novels/${key}/write`); },
              }}>
                <Button type="text" className="novel-header__work-switch" aria-label={`${t("workspace_switch")} · ${novel.title}`} title={novel.title}>
                  <span>{novel.title || t("novel_untitled")}</span><DownOutlined />
                </Button>
              </Dropdown>
            )}
            <Tabs
              className="novel-header__tabs"
              activeKey={getActiveTab()}
              items={tabItems}
              onChange={handleTabChange}
              style={{ marginBottom: 0, marginLeft: "0.5rem" }}
              size="large"
            />
          </div>
        }
      />

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
        className={writeTabActive ? "novel-content novel-content--write" : "novel-content"}
        style={{
          padding: writeTabActive ? "0.75rem 1rem 1rem" : "1rem",
          maxWidth: writeTabActive ? 1600 : 1200,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <AntApp component={false}>
          <Outlet context={{ novel, setNovel }} />
        </AntApp>
      </Content>
    </Layout>
  );
}
