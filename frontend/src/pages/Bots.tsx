import { Archive, Bot, Download, FlaskConical, History, Rocket, TerminalSquare } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { FallbackSpinner } from "@/components/ui/FallbackSpinner";
import { DeployBotDialog } from "@/components/bots/DeployBotDialog";
import { useServer } from "@/hooks/useServer";

const ActiveBotsTab = lazy(() =>
  import("@/pages/tabs/ActiveBotsTab").then((m) => ({ default: m.ActiveBotsTab })),
);
const BotRunsTab = lazy(() =>
  import("@/pages/tabs/BotRunsTab").then((m) => ({ default: m.BotRunsTab })),
);
const ArchivedBotsTab = lazy(() =>
  import("@/pages/tabs/ArchivedBotsTab").then((m) => ({ default: m.ArchivedBotsTab })),
);
const BacktestingTab = lazy(() =>
  import("@/pages/tabs/BacktestingTab").then((m) => ({ default: m.BacktestingTab })),
);
const EditorTab = lazy(() =>
  import("@/pages/tabs/EditorTab").then((m) => ({ default: m.EditorTab })),
);

const TABS = [
  { key: "active", label: "Active", icon: Bot },
  { key: "runs", label: "Runs", icon: History },
  { key: "editor", label: "Editor", icon: TerminalSquare },
  { key: "backtest", label: "Backtest", icon: FlaskConical },
  { key: "archived", label: "Archived", icon: Archive },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function Bots() {
  const { server } = useServer();
  const [showDeploy, setShowDeploy] = useState(false);
  const [showImportPosition, setShowImportPosition] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = (searchParams.get("tab") as TabKey) || "active";
  const visitedRef = useRef<Set<TabKey>>(new Set([currentTab]));
  visitedRef.current.add(currentTab);

  const setTab = (tab: TabKey) => {
    if (tab === "active") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab }, { replace: true });
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 w-fit">
          {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              currentTab === key
                ? "bg-[var(--color-bg)] text-[var(--color-text)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
          ))}
        </div>
        {currentTab === "active" && server && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImportPosition(true)}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              <Download className="h-4 w-4" />
              导入持仓
            </button>
            <button
              onClick={() => setShowDeploy(true)}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-5 py-2 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-[var(--color-primary)]/20"
            >
              <Rocket className="h-4 w-4" />
              Deploy Bot
            </button>
          </div>
        )}
      </div>

      {/* Tab content — keep visited tabs mounted but hidden */}
      <Suspense fallback={<FallbackSpinner />}>
        {visitedRef.current.has("active") && (
          <div style={{ display: currentTab === "active" ? undefined : "none" }}>
            <ActiveBotsTab
              showImportPosition={showImportPosition}
              onImportPositionClose={() => setShowImportPosition(false)}
            />
          </div>
        )}
        {visitedRef.current.has("runs") && (
          <div style={{ display: currentTab === "runs" ? undefined : "none" }}>
            <BotRunsTab />
          </div>
        )}
        {visitedRef.current.has("archived") && (
          <div style={{ display: currentTab === "archived" ? undefined : "none" }}>
            <ArchivedBotsTab />
          </div>
        )}
        {visitedRef.current.has("backtest") && (
          <div style={{ display: currentTab === "backtest" ? undefined : "none" }}>
            <BacktestingTab />
          </div>
        )}
        {visitedRef.current.has("editor") && (
          <div style={{ display: currentTab === "editor" ? undefined : "none" }}>
            <EditorTab />
          </div>
        )}
      </Suspense>
      {server && (
        <DeployBotDialog open={showDeploy} onClose={() => setShowDeploy(false)} server={server} />
      )}
    </div>
  );
}
