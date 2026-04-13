import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (user) nav("/", { replace: true });
  }, [user, nav]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await login(email, password);
      nav("/", { replace: true });
    } catch (ex) {
      setErr(apiErrorMessage(ex));
    }
  }

  return (
    <div className="app-shell" style={{ maxWidth: 420 }}>
      <div className="top-bar">
        <span className="brand">InkMind</span>
        <Link to="/register">注册</Link>
      </div>
      <div className="card">
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "1.35rem", marginTop: 0 }}>登录</h1>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {err ? <p className="form-error">{err}</p> : null}
          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "0.5rem" }}>
            登录
          </button>
        </form>
      </div>
    </div>
  );
}
