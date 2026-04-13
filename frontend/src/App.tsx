import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import Dashboard from "@/pages/Dashboard";
import Login from "@/pages/Login";
import NovelLayout from "@/pages/NovelLayout";
import NovelPeople from "@/pages/NovelPeople";
import NovelSettings from "@/pages/NovelSettings";
import NovelWrite from "@/pages/NovelWrite";
import Register from "@/pages/Register";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">加载中…</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: loc }} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/novels/:novelId"
        element={
          <ProtectedRoute>
            <NovelLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="write" replace />} />
        <Route path="settings" element={<NovelSettings />} />
        <Route path="write" element={<NovelWrite />} />
        <Route path="people" element={<NovelPeople />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
