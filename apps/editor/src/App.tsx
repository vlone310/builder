import { useRoute } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { EditorPage } from "./pages/EditorPage";
import { LoginPage } from "./pages/LoginPage";
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
  const { session } = useSession();
  const { path, query } = useRoute();
  if (!session) return <LoginPage />;
  const [section, id] = path;
  if (section === "sites" && id) return <SitePage siteId={id} />;
  if (section === "pages" && id)
    return <EditorPage key={id} pageId={id} envId={query.get("env")} />;
  return <SitesPage />;
}
