import { useRoute } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { EditorPage } from "./pages/EditorPage";
import { InvitePage } from "./pages/InvitePage";
import { Card, LoginPage } from "./pages/LoginPage";
import { MembersPage } from "./pages/MembersPage";
import { OrgPickerPage } from "./pages/OrgPickerPage";
import { SitePage } from "./pages/SitePage";
import { SitesPage } from "./pages/SitesPage";

export function App() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}

function Routes() {
  const { session, identity, restoring } = useSession();
  const { path, query } = useRoute();
  const [section, id] = path;
  if (section === "invite" && id) return <InvitePage key={id} token={id} />;
  if (!session) {
    if (restoring) return <Card title="Builder">Loading…</Card>;
    return identity ? <OrgPickerPage /> : <LoginPage />;
  }
  if (section === "members") return <MembersPage />;
  if (section === "sites" && id) return <SitePage siteId={id} />;
  if (section === "pages" && id)
    return <EditorPage key={id} pageId={id} envId={query.get("env")} />;
  return <SitesPage />;
}
