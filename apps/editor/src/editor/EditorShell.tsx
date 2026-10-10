import { useEditor } from "../store/editor";
import { Banner, Tabs } from "../ui";
import { Canvas } from "./Canvas";
import { Layers } from "./Layers";
import { Palette } from "./Palette";
import { PropsPanel } from "./PropsPanel";
import { Toolbar } from "./Toolbar";
import { useShortcuts } from "./useShortcuts";

export function EditorShell() {
  useShortcuts();
  const save = useEditor((s) => s.save);
  const host = useEditor((s) => s.host);
  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      {save.status === "conflict" && (
        <Banner tone="danger">
          {save.message}{" "}
          <button type="button" className="underline" onClick={() => window.location.reload()}>
            Reload
          </button>
        </Banner>
      )}
      {save.status === "locked" && (
        <Banner tone="danger">Someone else took over this page: {save.message}</Banner>
      )}
      {host.status === "error" && <Banner tone="danger">Host app: {host.message}</Banner>}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel max-md:hidden">
          <Tabs.Root defaultValue="insert" className="flex min-h-0 flex-1 flex-col">
            <Tabs.List>
              <Tabs.Trigger value="insert">Insert</Tabs.Trigger>
              <Tabs.Trigger value="layers">Layers</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="insert" className="min-h-0 flex-1 overflow-y-auto">
              <Palette />
            </Tabs.Content>
            <Tabs.Content value="layers" className="min-h-0 flex-1 overflow-y-auto">
              <Layers />
            </Tabs.Content>
          </Tabs.Root>
        </aside>
        <main className="min-w-0 flex-1">
          <Canvas />
        </main>
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel max-lg:hidden">
          <PropsPanel />
        </aside>
      </div>
    </div>
  );
}
