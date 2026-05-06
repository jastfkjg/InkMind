import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
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
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminUserDetail from "@/pages/admin/AdminUserDetail";
import AdminLogs from "@/pages/admin/AdminLogs";
import AiAssistantFloating from "@/components/AiAssistantFloating";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">{t("app_loading")}</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: loc }} replace />;
  }
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">{t("app_loading")}</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: loc }} replace />;
  }
  if (!user.is_admin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function NovelPageWrapper({ children }: { children: React.ReactNode }) {
  const { novelId } = useParams<{ novelId: string }>();
  const novelIdNum = novelId ? parseInt(novelId, 10) : undefined;
  
  return (
    <>
      {children}
      <AiAssistantFloating novelId={novelIdNum} />
    </>
  );
}

function PageWrapper({ children, showAssistant = true }: { children: React.ReactNode; showAssistant?: boolean }) {
  return (
    <>
      {children}
      {showAssistant && <AiAssistantFloating />}
    </>
  );
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <PageWrapper>
                <Dashboard />
              </PageWrapper>
            </ProtectedRoute>
          }
        />
        <Route
          path="/usage"
          element={
            <ProtectedRoute>
              <PageWrapper>
                <UsageDashboard />
              </PageWrapper>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <PageWrapper showAssistant={false}>
                <AiSettings />
              </PageWrapper>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks"
          element={
            <ProtectedRoute>
              <PageWrapper>
                <BackgroundTasks />
              </PageWrapper>
            </ProtectedRoute>
          }
        />
        <Route
          path="/novels/:novelId"
          element={
            <ProtectedRoute>
              <NovelPageWrapper>
                <NovelLayout />
              </NovelPageWrapper>
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
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:userId" element={<AdminUserDetail />} />
          <Route path="logs" element={<AdminLogs />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
