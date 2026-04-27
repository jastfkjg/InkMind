import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import Dashboard from "@/pages/Dashboard";
import Login from "@/pages/Login";
import NovelLayout from "@/pages/NovelLayout";
import NovelPeople from "@/pages/NovelPeople";
import NovelPeopleForm from "@/pages/NovelPeopleForm";
import PeopleLayout from "@/pages/PeopleLayout";
import MemosLayout from "@/pages/MemosLayout";
import NovelMemos from "@/pages/NovelMemos";
import NovelMemoForm from "@/pages/NovelMemoForm";
import NovelSettings from "@/pages/NovelSettings";
import NovelWrite from "@/pages/NovelWrite";
import Register from "@/pages/Register";
import UsageDashboard from "@/pages/UsageDashboard";
import AiSettings from "@/pages/AiSettings";
import BackgroundTasks from "@/pages/BackgroundTasks";

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
        path="/usage"
        element={
          <ProtectedRoute>
            <UsageDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <AiSettings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks"
        element={
          <ProtectedRoute>
            <BackgroundTasks />
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
        <Route path="people" element={<PeopleLayout />}>
          <Route index element={<NovelPeople />} />
          <Route path="new" element={<NovelPeopleForm />} />
          <Route path=":characterId/edit" element={<NovelPeopleForm />} />
        </Route>
        <Route path="memos" element={<MemosLayout />}>
          <Route index element={<NovelMemos />} />
          <Route path="new" element={<NovelMemoForm />} />
          <Route path=":memoId/edit" element={<NovelMemoForm />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
