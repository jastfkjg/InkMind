import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import UserMenu from "@/components/UserMenu";
import { apiErrorMessage, fetchLlmUsage } from "@/api/client";
import type { LlmUsageSummary } from "@/types";

function fmtNum(n: number) {
  return new Intl.NumberFormat("zh-CN").format(n);
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
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            每次 LLM 调用的时间、类型与 token 估算值
          </p>
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
        <div className="grid-3 usage-summary-grid">
          <div className="card usage-summary-card">
            <div className="muted">总调用次数</div>
            <div className="usage-summary-num">{fmtNum(data.total_calls)}</div>
          </div>
          <div className="card usage-summary-card">
            <div className="muted">输入 Token（估算）</div>
            <div className="usage-summary-num">{fmtNum(data.total_input_tokens)}</div>
          </div>
          <div className="card usage-summary-card">
            <div className="muted">输出 Token（估算）</div>
            <div className="usage-summary-num">{fmtNum(data.total_output_tokens)}</div>
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
                  <td>{fmtNum(it.input_tokens)}</td>
                  <td>{fmtNum(it.output_tokens)}</td>
                  <td>{fmtNum(it.total_tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
