import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  App as AntApp,
  Layout,
  Tabs,
  Button,
  Alert,
  Typography,
  Space,
  Tag,
} from "antd";
import {
  ArrowLeftOutlined,
  SettingOutlined,
  EditOutlined,
  TeamOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { apiErrorMessage, fetchNovel } from "@/api/client";
import AppHeader, { useHeaderTheme } from "@/components/AppHeader";
import { useI18n } from "@/i18n";
import type { Novel } from "@/types";

const { Content } = Layout;
const { Title } = Typography;

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

  const bgColor = colors.bgColor;
  const bgLinear = colors.bgLinear;
  const bgRadial = colors.bgRadial;
  const textColor = colors.textColor;

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
            <Button className="novel-header__back" aria-label={t("nav_dashboard")} type="text" icon={<ArrowLeftOutlined />} onClick={() => nav("/")} size="large">
              {t("nav_back")}
            </Button>
            {novel && (
              <div className="novel-header__identity">
                <Title level={5} title={novel.title} style={{
                  margin: 0,
                  fontFamily: '"Noto Serif SC", "DM Serif Display", Georgia, serif',
                  color: textColor,
                  transition: "color 0.3s ease",
                }}>
                  {novel.title || t("novel_untitled")}
                </Title>
                {novel.genre && <Tag style={{ margin: 0 }}>{novel.genre}</Tag>}
              </div>
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
