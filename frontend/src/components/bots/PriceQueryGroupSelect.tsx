import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings2, X } from "lucide-react";
import { useState } from "react";

import { api, type PriceQueryGroup } from "@/lib/api";

const CREATE_VALUE = "__create_price_query_group__";

export function PriceQueryGroupSelect({ server, value, onChange, disabled = false }: {
  server: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const groupsQuery = useQuery({ queryKey: ["price-query-groups", server], queryFn: () => api.getPriceQueryGroups(server), enabled: Boolean(server) });
  const refresh = () => client.invalidateQueries({ queryKey: ["price-query-groups", server] });
  const create = useMutation({ mutationFn: (name: string) => api.createPriceQueryGroup(server, name), onSuccess: (group) => { onChange(group.name); setDraft(""); setCreating(false); setError(""); refresh(); }, onError: (cause) => setError(cause instanceof Error ? cause.message : "创建报价分组失败") });
  const rename = useMutation({ mutationFn: ({ current, next }: { current: string; next: string }) => api.renamePriceQueryGroup(server, current, next), onSuccess: ({ group }) => { if (value.trim().toLocaleLowerCase() === group.name.trim().toLocaleLowerCase()) onChange(group.name); setError(""); refresh(); }, onError: (cause) => setError(cause instanceof Error ? cause.message : "重命名报价分组失败") });
  const remove = useMutation({ mutationFn: (name: string) => api.deletePriceQueryGroup(server, name), onSuccess: (_, name) => { if (value === name) onChange(""); setError(""); refresh(); }, onError: (cause) => setError(cause instanceof Error ? cause.message : "删除报价分组失败") });
  const groups = groupsQuery.data?.items ?? [];
  return <div className="min-w-0 w-full">
    <div className="flex gap-2"><select aria-label="报价分组" value={value || ""} disabled={disabled || groupsQuery.isLoading} onChange={(event) => { if (event.target.value === CREATE_VALUE) { setCreating(true); return; } onChange(event.target.value); }} className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"><option value="">独立查询</option>{!groups.some((group) => group.name === value) && value && <option value={value}>{value}（当前配置）</option>}{groups.map((group) => <option key={group.normalized_name} value={group.name}>{group.name}</option>)}<option value={CREATE_VALUE}>+ 新建报价分组…</option></select><button type="button" onClick={() => setManaging(true)} disabled={disabled} aria-label="管理报价分组" className="rounded-md border border-[var(--color-border)] px-3"><Settings2 className="h-4 w-4" /></button></div>
    {creating && <div className="mt-2 flex gap-2"><input autoFocus value={draft} maxLength={64} placeholder="输入分组名称" onChange={(event) => setDraft(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" /><button type="button" disabled={!draft.trim() || create.isPending} onClick={() => create.mutate(draft)} className="rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm text-white">创建并选用</button><button type="button" onClick={() => { setCreating(false); setDraft(""); }} className="rounded-md px-2 text-sm">取消</button></div>}
    {(error || groupsQuery.isError) && <p className="mt-1 text-xs text-[var(--color-red)]">{error || "报价分组读取失败"}</p>}
    {managing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setManaging(false)}><div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4"><h3 className="font-semibold">管理报价分组</h3><button type="button" onClick={() => setManaging(false)} aria-label="关闭"><X className="h-5 w-5" /></button></div><div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">{groups.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">还没有保存的报价分组。</p> : groups.map((group: PriceQueryGroup) => { const next = renameDrafts[group.normalized_name] ?? group.name; return <div key={group.normalized_name} className="rounded-md border border-[var(--color-border)] p-3"><div className="flex gap-2"><input value={next} maxLength={64} onChange={(event) => setRenameDrafts((old) => ({ ...old, [group.normalized_name]: event.target.value }))} className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm" /><button type="button" disabled={rename.isPending || next.trim() === group.name} onClick={() => rename.mutate({ current: group.name, next })} className="rounded border px-2 text-xs">重命名</button></div><p className="mt-2 text-xs text-[var(--color-text-muted)]">{group.reference_count ? `正在被 ${group.references.map((ref) => ref.display_name || ref.bot_name || ref.config_id).join("、")} 使用，不能删除。` : "未被 Bot 使用，可以删除。"}</p><button type="button" disabled={group.reference_count > 0 || remove.isPending} onClick={() => remove.mutate(group.name)} className="mt-2 inline-flex items-center gap-1 rounded border border-[var(--color-red)]/40 px-2 py-1 text-xs text-[var(--color-red)] disabled:opacity-40"><Plus className="h-3 w-3 rotate-45" />删除</button></div>; })}</div></div></div>}
  </div>;
}
