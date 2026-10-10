import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
import "@/styles/terms.css";

const SUPPORT_EMAIL = "zhou.zilong@qq.com";
const TERMS_VERSION = "2026-10-10";
const sections = ["service", "credits", "payment", "refund", "quality", "data", "changes", "rights"] as const;

export default function Terms() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${t("terms_title")} · InkMind`;
    return () => { document.title = previousTitle; };
  }, [t]);

  return <div className="terms-page">
    <AppHeader
      leftContent={<Link to="/" className="terms-brand">InkMind</Link>}
      back={{ label: t(user ? "terms_back_usage" : "terms_back_login"), onClick: () => navigate(user ? "/usage" : "/login") }}
      showAccountMenu={Boolean(user)}
      padding="12px 1rem"
      headerStyle={{ flexWrap: "wrap", gap: 8 }}
    />
    <main className="terms-document" aria-labelledby="terms-title">
      <header className="terms-intro">
        <p className="terms-version">{t("terms_version").replace("{date}", TERMS_VERSION)}</p>
        <h1 id="terms-title">{t("terms_title")}</h1>
        <p>{t("terms_intro")}</p>
        <dl className="terms-contact">
          <div><dt>{t("terms_operator")}</dt><dd>{t("terms_operator_name")}</dd></div>
          <div><dt>{t("terms_site")}</dt><dd><a href="https://inkmind.jastcraft.com">inkmind.jastcraft.com</a></dd></div>
          <div><dt>{t("terms_support")}</dt><dd><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></dd></div>
        </dl>
      </header>
      {sections.map(section => <section key={section} className="terms-section" aria-labelledby={`terms-${section}`}>
        <h2 id={`terms-${section}`}>{t(`terms_${section}_title`)}</h2>
        <p>{t(`terms_${section}_body`)}</p>
        {section !== "rights" && <p>{t(`terms_${section}_detail`)}</p>}
      </section>)}
      <footer className="terms-footer">
        <p>{t("terms_contact_hint")}</p>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </footer>
    </main>
  </div>;
}
