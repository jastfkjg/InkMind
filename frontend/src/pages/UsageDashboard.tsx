import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import UserMenu from "@/components/UserMenu";
import { apiErrorMessage, fetchLlmUsage } from "@/api/client";
import type { LlmUsageSummary } from "@/types";

function fmtNum(n: number) {
  return new Intl.NumberFormat("zh-CN").format(n);
}

function fmtK(n: number) {
  return `${(n / 1000).toFixed(1)}K`;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function UsageDashboard() {
  const [data, setData] = useState<LlmUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const r = await fetchLlmUsage(200);
      setData(r);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="app-shell">
      <header className="top-bar top-bar--dashboard">
        <div>
          <div className="brand brand--list">Token 用量统计</div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <Link to="/" className="btn btn-ghost">
            ← 返回作品
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => void load()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
          <UserMenu />
        </div>
      </header>

      {err ? <p className="form-error">{err}</p> : null}

      {data ? (
        <div className="card usage-summary-strip">
          <div className="usage-summary-strip__item">
            <div className="usage-summary-strip__label">剩余配额</div>
            <div
              className="usage-summary-strip__value"
              style={{ color: data.token_remaining < 50000 ? "#e53e3e" : undefined }}
            >
              {fmtK(data.token_remaining)}
            </div>
          </div>
          <div className="usage-summary-strip__item">
            <div className="usage-summary-strip__label">总消耗</div>
            <div className="usage-summary-strip__value">{fmtK(data.total_tokens)}</div>
          </div>
          <div className="usage-summary-strip__item">
            <div className="usage-summary-strip__label">总调用次数</div>
            <div className="usage-summary-strip__value">{fmtNum(data.total_calls)}</div>
          </div>
          <div className="usage-summary-strip__item">
            <div className="usage-summary-strip__label">总输入 Token</div>
            <div className="usage-summary-strip__value">{fmtK(data.total_input_tokens)}</div>
          </div>
          <div className="usage-summary-strip__item">
            <div className="usage-summary-strip__label">总输出 Token</div>
            <div className="usage-summary-strip__value">{fmtK(data.total_output_tokens)}</div>
          </div>
        </div>
      ) : null}

      <div className="card usage-table-wrap">
        {loading ? (
          <p className="muted" style={{ margin: 0 }}>
            加载中…
          </p>
        ) : !data || data.items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            暂无用量记录。先使用一次 AI 生成功能再刷新看看。
          </p>
        ) : (
          <table className="usage-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>模型厂商</th>
                <th>输入 Token</th>
                <th>输出 Token</th>
                <th>总 Token</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id}>
                  <td>{fmtTime(it.created_at)}</td>
                  <td>{it.action || "-"}</td>
                  <td>{it.provider || "-"}</td>
                  <td>{fmtK(it.input_tokens)}</td>
                  <td>{fmtK(it.output_tokens)}</td>
                  <td>{fmtK(it.total_tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
