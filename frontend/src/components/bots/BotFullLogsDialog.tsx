import { useInfiniteQuery } from "@tanstack/react-query";
import { RefreshCw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { api, type BotLogCategory } from "@/lib/api";

type LogType = "main" | "system" | "error";
type TimeRange = "all" | "1h" | "6h" | "24h" | "7d" | "custom";

const CATEGORY_OPTIONS: Array<[BotLogCategory, string]> = [
  ["all", "全部"],
  ["ordinary", "普通状态"],
  ["buy_tracking", "买入跟踪"],
  ["sell_tracking", "卖出跟踪"],
  ["quote", "报价查询"],
  ["other", "其他"],
];

const TIME_OPTIONS: Array<[TimeRange, string]> = [
  ["all", "全部时间"],
  ["1h", "最近 1 小时"],
  ["6h", "最近 6 小时"],
  ["24h", "最近 24 小时"],
  ["7d", "最近 7 天"],
  ["custom", "自定义"],
];

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function presetStartTime(range: TimeRange): string {
  const hours = range === "1h" ? 1 : range === "6h" ? 6 : range === "24h" ? 24 : range === "7d" ? 168 : 0;
  return hours > 0 ? localDateTime(new Date(Date.now() - hours * 60 * 60 * 1000)) : "";
}

export function BotFullLogsDialog({ server, botName, displayName, onClose }: {
  server: string; botName: string; displayName: string; onClose: () => void;
}) {
  const [logType, setLogType] = useState<LogType>("main");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<BotLogCategory>("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [customStart, setCustomStart] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return localDateTime(today).slice(0, 16);
  });
  const [customEnd, setCustomEnd] = useState(() => localDateTime(new Date()).slice(0, 16));
  const logsQuery = useInfiniteQuery({
    queryKey: ["bot-full-logs", server, botName, logType, query, category, timeRange, customStart, customEnd],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.getBotFullLogs(
      server,
      botName,
      logType,
      pageParam,
      query,
      category,
      timeRange === "custom" ? customStart : presetStartTime(timeRange),
      timeRange === "custom" ? customEnd : "",
    ),
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_offset : undefined,
  });
  const lines = useMemo(
    () => (logsQuery.data?.pages ?? []).flatMap((page) => page.lines),
    [logsQuery.data?.pages],
  );
  const latest = logsQuery.data?.pages[0];

  return <div
    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 py-4 backdrop-blur-sm"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    <div
      className="flex h-[82vh] min-w-[min(720px,100vw)] max-w-[100vw] flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl"
      style={{ width: "96vw", resize: "horizontal" }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between border-b border-[var(--color-border)] px-5 py-4">
        <div className="min-w-0"><h3 className="font-semibold">完整日志</h3><p className="mt-1 truncate text-xs text-[var(--color-text-muted)]" title={botName}>{displayName}</p></div>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-[var(--color-surface-hover)]" aria-label="关闭"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        {([['main', '运行日志'], ['system', '系统日志'], ['error', '错误日志']] as const).map(([type, label]) => <button key={type} type="button" onClick={() => setLogType(type)} className={`rounded-md px-3 py-1.5 text-xs ${logType === type ? "bg-[var(--color-primary)] text-white" : "border border-[var(--color-border)]"}`}>{label}</button>)}
        <form className="ml-auto flex min-w-[260px] gap-2" onSubmit={(event) => { event.preventDefault(); setQuery(searchInput.trim()); }}>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索完整文件" className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs" />
          <button type="submit" className="rounded-md border border-[var(--color-border)] p-2" title="搜索"><Search className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => logsQuery.refetch()} className="rounded-md border border-[var(--color-border)] p-2" title="刷新"><RefreshCw className={`h-3.5 w-3.5 ${logsQuery.isRefetching ? "animate-spin" : ""}`} /></button>
        </form>
      </div>
      <div className="space-y-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[var(--color-text-muted)]">分类</span>
          {CATEGORY_OPTIONS.map(([value, label]) => <button key={value} type="button" onClick={() => setCategory(value)} className={`rounded-md px-2.5 py-1 text-xs ${category === value ? "bg-[var(--color-primary)] text-white" : "border border-[var(--color-border)]"}`}>{label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[var(--color-text-muted)]">时间</span>
          <select value={timeRange} onChange={(event) => setTimeRange(event.target.value as TimeRange)} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs">
            {TIME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {timeRange === "custom" && <>
            <label className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">开始<input type="datetime-local" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1" /></label>
            <label className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">结束<input type="datetime-local" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1" /></label>
          </>}
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-[#111827] py-3 font-mono text-xs leading-5 text-slate-200">
        {logsQuery.isLoading ? <p className="text-slate-400">正在读取完整日志…</p>
          : logsQuery.isError ? <p className="text-red-400">{logsQuery.error instanceof Error ? logsQuery.error.message : "读取日志失败"}</p>
            : lines.length === 0 ? <p className="text-slate-400">没有匹配的日志。</p>
              : <>{lines.map((line) => <div key={`${line.number}-${line.text}`} className="grid grid-cols-[5rem_1fr] gap-3 whitespace-pre-wrap break-words"><span className="select-none text-right text-slate-500">{line.number}</span><span>{line.text || " "}</span></div>)}{logsQuery.hasNextPage && <div className="mt-3 text-center"><button type="button" disabled={logsQuery.isFetchingNextPage} onClick={() => logsQuery.fetchNextPage()} className="rounded border border-slate-600 px-3 py-1 text-slate-300 disabled:opacity-50">{logsQuery.isFetchingNextPage ? "正在加载…" : "加载更早日志"}</button></div>}</>}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]"><span>{latest ? `${latest.total_lines.toLocaleString()} 行 · ${(latest.file_size / 1024 / 1024).toFixed(2)} MB` : ""}</span><span>拖动弹窗右下角可调整宽度</span></div>
    </div>
  </div>;
}
