import { api } from "./client";

export type CreditPackage = { id: string; name: string; name_en: string; amount_cents: number; credits: number };
export type BillingCatalog = { enabled: boolean; sandbox: boolean; can_purchase: boolean; packages: CreditPackage[]; models: { provider: string; model: string; input_rate: string; output_rate: string }[]; terms_url: string; support_email: string };
export type PaymentOrder = { id: number; out_trade_no: string; package_id: string; subject: string; amount_cents: number; credits: number; remaining_credits: number; status: string; sandbox: boolean; created_at: string; expires_at: string };
export async function billingCatalog(): Promise<BillingCatalog> { return (await api.get<BillingCatalog>("/billing/catalog")).data; }
export async function paymentOrders(): Promise<PaymentOrder[]> { return (await api.get<PaymentOrder[]>("/billing/orders")).data; }
export async function createPaymentOrder(packageId: string, requestKey: string): Promise<PaymentOrder> {
  return (await api.post<PaymentOrder>("/billing/orders", { package_id: packageId, request_key: requestKey, accept_terms: true })).data;
}
export async function checkoutOrder(id: number): Promise<string> {
  return (await api.post<{ payment_html: string }>(`/billing/orders/${id}/checkout`)).data.payment_html;
}
export async function queryPaymentOrder(id: number): Promise<PaymentOrder> { return (await api.post<PaymentOrder>(`/billing/orders/${id}/query`)).data; }
export async function closePaymentOrder(id: number): Promise<PaymentOrder> { return (await api.post<PaymentOrder>(`/billing/orders/${id}/close`)).data; }
