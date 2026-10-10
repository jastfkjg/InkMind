import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Modal, Space, Table, Tag, Typography } from "antd";
import { apiErrorMessage, isDesktopApp } from "@/api/client";
import { billingCatalog, paymentOrders, createPaymentOrder, checkoutOrder, queryPaymentOrder, closePaymentOrder, type BillingCatalog, type CreditPackage, type PaymentOrder } from "@/api/billing";
import { useI18n } from "@/i18n";
import "@/styles/billing.css";

export default function BillingPanel({ onPaymentChange }: { onPaymentChange: () => void }) {
  const { t, isZh } = useI18n();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [selected, setSelected] = useState<CreditPackage | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<number | "purchase" | null>(null);
  const [error, setError] = useState("");
  const requestKeys = useRef<Record<string, string>>({});
  const changeRef = useRef(onPaymentChange);
  changeRef.current = onPaymentChange;
  const money = (cents: number) => new Intl.NumberFormat(isZh ? "zh-CN" : "en-US", { style: "currency", currency: "CNY" }).format(cents / 100);

  async function reload(): Promise<void> {
    const list = await paymentOrders();
    setOrders(list);
    for (const order of list) if (order.status !== "pending") delete requestKeys.current[order.package_id];
  }

  useEffect(() => {
    if (isDesktopApp) return;
    let active = true;
    void Promise.all([billingCatalog(), paymentOrders()]).then(([configuration, list]) => {
      if (active) { setCatalog(configuration); setOrders(list); }
    }).catch(() => { /* Preserve the existing usage page when billing is unavailable. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isDesktopApp || !catalog) return;
    const refresh = () => { void reload().catch(() => undefined); changeRef.current(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [catalog]);

  if (isDesktopApp || !catalog || (!catalog.enabled && orders.length === 0)) return null;

  async function purchase(packageId: string, existing?: PaymentOrder): Promise<void> {
    // Open during the user's click so the browser does not block the payment window.
    const popup = window.open("", "_blank");
    if (!popup) { setError(t("billing_popup_blocked")); return; }
    popup.opener = null;
    popup.document.title = t("billing_opening");
    popup.document.body.textContent = t("billing_opening");
    setBusy("purchase"); setError("");
    try {
      requestKeys.current[packageId] ||= crypto.randomUUID().replaceAll("-", "");
      const pending = existing || orders.find(order => order.package_id === packageId && order.status === "pending" && new Date(order.expires_at).getTime() > Date.now());
      const order = pending || await createPaymentOrder(packageId, requestKeys.current[packageId]);
      await reload();
      const html = await checkoutOrder(order.id);
      if (!new DOMParser().parseFromString(html, "text/html").querySelector("form")) throw new Error(t("billing_form_missing"));
      // The official SDK includes its own auto-submit script; render it once.
      popup.document.open(); popup.document.write(html); popup.document.close();
      setSelected(null); setAccepted(false);
    } catch (reason) {
      popup.close(); setError(apiErrorMessage(reason));
    } finally { setBusy(null); }
  }

  async function updateOrder(order: PaymentOrder, close = false): Promise<void> {
    setBusy(order.id); setError("");
    try {
      await (close ? closePaymentOrder(order.id) : queryPaymentOrder(order.id));
      await reload(); changeRef.current();
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setBusy(null); }
  }

  return <section className="billing-panel" aria-labelledby="billing-title">
    <div className="billing-heading"><Typography.Title id="billing-title" level={4}>{t("billing_title")}</Typography.Title>
      {catalog.sandbox && <Tag>{t("billing_sandbox")}</Tag>}
    </div>
    {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}
    {catalog.enabled && <>
      <p className="billing-description">{t("billing_description")}</p>
      {!!catalog.models?.length && <div className="billing-description">{catalog.models.map(model => <div key={`${model.provider}:${model.model}`}>{model.model} · {t("billing_model_rate").replace("{input}", model.input_rate).replace("{output}", model.output_rate)}</div>)}</div>}
      <div className="billing-packages">{catalog.packages.map(item => <div className="billing-package" key={item.id}>
        <div><strong>{isZh ? item.name : item.name_en || item.name}</strong><span>{t("billing_credits").replace("{count}", item.credits.toLocaleString(isZh ? "zh-CN" : "en-US"))}</span></div>
        <strong>{money(item.amount_cents)}</strong>
        <Button disabled={!catalog.can_purchase || busy !== null} onClick={() => { setSelected(item); setAccepted(false); setError(""); }}>{t("billing_buy")}</Button>
      </div>)}</div>
      {!catalog.can_purchase && <p className="billing-description">{t("billing_unlimited")}</p>}
    </>}
    <div className="billing-heading"><Typography.Title level={5}>{t("billing_orders")}</Typography.Title>
      <Button size="small" disabled={busy !== null} onClick={() => void reload().catch(reason => setError(apiErrorMessage(reason)))}>{t("common_refresh")}</Button>
    </div>
    <Table<PaymentOrder> rowKey="id" size="small" dataSource={orders} pagination={{ pageSize: 5, hideOnSinglePage: true }} scroll={{ x: 650 }} locale={{ emptyText: t("billing_no_orders") }} columns={[
      { title: t("usage_table_time"), dataIndex: "created_at", render: (value: string) => new Date(value).toLocaleString(isZh ? "zh-CN" : "en-US"), width: 175 },
      { title: t("billing_order"), dataIndex: "out_trade_no", render: (value: string) => <Typography.Text copyable={{ text: value }}>{value.slice(-12)}</Typography.Text> },
      { title: t("billing_amount"), dataIndex: "amount_cents", render: money, width: 100 },
      { title: t("billing_status"), dataIndex: "status", render: (value: string) => t(`billing_status_${value}`), width: 110 },
      { title: t("billing_actions"), render: (_: unknown, order: PaymentOrder) => <Space wrap>
        <Button size="small" loading={busy === order.id} disabled={busy !== null} onClick={() => void updateOrder(order)}>{t("billing_query")}</Button>
        {order.status === "pending" && <>
          {catalog.enabled && new Date(order.expires_at).getTime() > Date.now() && <Button size="small" disabled={busy !== null} onClick={() => void purchase(order.package_id, order)}>{t("billing_pay")}</Button>}
          <Button size="small" disabled={busy !== null} onClick={() => void updateOrder(order, true)}>{t("billing_close")}</Button>
        </>}
      </Space>, width: 240 },
    ]} />
    {catalog.support_email && <p className="billing-description">{t("billing_refund_help")} <a href={`mailto:${catalog.support_email}`}>{catalog.support_email}</a></p>}
    <Modal title={t("billing_confirm")} open={selected !== null} onCancel={() => { if (busy === null) setSelected(null); }} confirmLoading={busy === "purchase"} cancelButtonProps={{ disabled: busy !== null }} okButtonProps={{ disabled: !accepted }} okText={t("billing_pay")} onOk={() => { if (selected) void purchase(selected.id); }}>
      {selected && <p>{isZh ? selected.name : selected.name_en || selected.name} · {money(selected.amount_cents)} · {t("billing_credits").replace("{count}", selected.credits.toLocaleString())}</p>}
      <p>{t("billing_description")}</p>
      <p className="billing-refund-summary">{t("billing_refund_summary")}</p>
      <Checkbox checked={accepted} onChange={event => setAccepted(event.target.checked)}>{t("billing_accept")} <a href={catalog.terms_url} target="_blank" rel="noopener noreferrer">{t("billing_terms")}</a></Checkbox>
      {catalog.sandbox && <p>{t("billing_sandbox_hint")}</p>}
    </Modal>
  </section>;
}
