import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart } from "recharts";

import { api, type BuyTrackingPoint } from "@/lib/api";
import { formatTime, toMs } from "@/lib/formatters";

type Range = "1h" | "3h" | "6h" | "12h" | "24h";

const RANGE_MS: Record<Range, number> = {
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const PRICE_LINES = [
  ["current_price_usd", "实时价格", "#60a5fa"],
  ["trough_price_usd", "最低价格", "#22c55e"],
  ["expected_buy_price_usd", "预计买入价格", "#f59e0b"],
] as const;
const PERCENT_LINES = [
  ["buy_drawdown_percent", "相对配置买入价下跌", "#a78bfa"],
  ["current_rebound_percent", "当前实时回弹", "#ec4899"],
  ["maximum_rebound_percent", "最大允许反弹", "#f97316"],
  ["expected_buy_drawdown_percent", "预计买入价下跌", "#14b8a6"],
] as const;
const ALL_LINES = [...PRICE_LINES, ...PERCENT_LINES];

interface Props {
  server: string;
  botName: string;
  controllerId: string;
  title: string;
}

export function BuyTrackingChart({ server, botName, controllerId, title }: Props) {
  const [range, setRange] = useState<Range>("1h");
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(ALL_LINES.map(([key]) => key)));
  const { data, isFetching } = useQuery({
    queryKey: ["buy-tracking-history", server, botName, controllerId, range],
    queryFn: () => api.getBuyTrackingHistory(server, botName, controllerId, range),
    enabled: !!server && !!botName && !!controllerId,
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
  const points = useMemo(() => (data?.points ?? []).map((point: BuyTrackingPoint) => ({ ...point, time: toMs(point.timestamp) })), [data]);
  // 查询范围与横轴范围必须一致，不能因刚开始采样而缩短为几分钟。
  const timeDomain = useMemo(() => {
    const end = Date.now();
    return [end - RANGE_MS[range], end] as [number, number];
  }, [range, points]);
  const timeTicks = useMemo(() => {
    const step = RANGE_MS[range] / 4;
    return Array.from({ length: 5 }, (_, index) => timeDomain[0] + step * index);
  }, [range, timeDomain]);
  const toggle = (key: string) => setEnabled((previous) => {
    const next = new Set(previous);
    if (next.has(key)) {
      if (next.size > 1) next.delete(key);
    } else next.add(key);
    return next;
  });

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">买入追踪</div>
          <div className="text-xs text-[var(--color-text-muted)]">{title}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {ALL_LINES.map(([key, label, color]) => <button key={key} onClick={() => toggle(key)} className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: color, color, opacity: enabled.has(key) ? 1 : 0.35 }}>{label}</button>)}
        </div>
      </header>
      <div className="flex gap-1 border-b border-[var(--color-border)] px-3 py-1.5">
        {(["1h", "3h", "6h", "12h", "24h"] as Range[]).map((value) => <button key={value} onClick={() => setRange(value)} className={`rounded px-2 py-0.5 text-xs ${range === value ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-muted)]"}`}>{value}</button>)}
      </div>
      {points.length < 2 ? <div className="px-3 py-10 text-center text-sm text-[var(--color-text-muted)]">{isFetching ? "正在读取买入追踪数据" : "暂无买入追踪数据"}</div> : (
        <div className="h-72 p-3"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={points} margin={{ top: 8, right: 20, bottom: 0, left: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" /><XAxis dataKey="time" type="number" scale="time" domain={timeDomain} allowDataOverflow ticks={timeTicks} tickFormatter={(value) => formatTime(value)} minTickGap={48} /><YAxis yAxisId="price" tickFormatter={(value) => `$${Number(value).toFixed(4)}`} width={72} /><YAxis yAxisId="percent" orientation="right" tickFormatter={(value) => `${Number(value).toFixed(1)}%`} width={56} /><Tooltip labelFormatter={(value) => formatTime(Number(value))} formatter={(value, name) => [String(name).includes("价格") ? `$${Number(value ?? 0).toFixed(6)}` : `${Number(value ?? 0).toFixed(2)}%`, String(name)]} /><Legend verticalAlign="bottom" height={0} wrapperStyle={{ display: "none" }} />{PRICE_LINES.map(([key, label, color]) => enabled.has(key) && <Line key={key} yAxisId="price" dataKey={key} name={label} stroke={color} dot={false} strokeWidth={2} />)}{PERCENT_LINES.map(([key, label, color]) => enabled.has(key) && <Line key={key} yAxisId="percent" dataKey={key} name={label} stroke={color} dot={false} strokeDasharray="4 3" />)}</ComposedChart></ResponsiveContainer></div>
      )}
    </section>
  );
}
