import yaml from "js-yaml";

// Canonical key always hidden from the config→YAML view: `id` is the config's
// identifier, set out-of-band (URL / new-id field), never edited inline.
const ALWAYS_HIDDEN_KEYS = ["id"] as const;

// Extra read-only controller-identity keys. These are NOT stripped by default
// because most editors round-trip the YAML back to the server on save, and
// dropping them would lose `controller_name` / `controller_type`. Only the
// read-only / partial-update controller browser opts into hiding them.
export const CONTROLLER_HIDDEN_KEYS = ["controller_name", "controller_type"] as const;

export interface ConfigToYamlOptions {
  /** Extra keys to strip in addition to `id` (e.g. CONTROLLER_HIDDEN_KEYS). */
  hiddenKeys?: readonly string[];
  /** Strip keys with a leading underscore (internal/computed fields). */
  stripUnderscore?: boolean;
  /** Sort object keys alphabetically in the output. Defaults to false. */
  sortKeys?: boolean;
  /** 按用途分组，并在每组前加入说明。 */
  groupSections?: boolean;
}

const TRADE_KEYS = new Set([
  "chain",
  "connector_name",
  "dex",
  "network",
  "trading_pair",
  "trading_type",
  "wallet_address",
]);

const CONTROLLER_KEYS = new Set([
  "controller_name",
  "controller_type",
  "initial_positions",
  "total_amount_quote",
]);

const RUNTIME_KEYS = new Set(["live_trading", "manual_kill_switch"]);

function sectionForKey(key: string): string {
  if (key.startsWith("buy_")) return "买入规则";
  if (key.startsWith("sell_")) return "卖出规则";
  if (TRADE_KEYS.has(key)) return "交易对象";
  if (CONTROLLER_KEYS.has(key)) return "控制器信息";
  if (key.endsWith("check_interval")) return "检查频率";
  if (
    key.endsWith("price_url") ||
    key.endsWith("price_cache_seconds") ||
    key.includes("quote_age") ||
    key.includes("retry_")
  ) {
    return "行情接口与失败重试";
  }
  if (RUNTIME_KEYS.has(key)) return "安全与运行模式";
  return "其他配置";
}

function dumpGroupedYaml(config: Record<string, unknown>, sortKeys: boolean): string {
  const sections = new Map<string, Record<string, unknown>>();
  for (const [key, value] of Object.entries(config)) {
    const title = sectionForKey(key);
    const section = sections.get(title) ?? {};
    section[key] = value;
    sections.set(title, section);
  }

  return [...sections.entries()]
    .map(
      ([title, values]) =>
        `# ${title}\n${yaml.dump(values, { lineWidth: -1, noRefs: true, sortKeys }).trimEnd()}`,
    )
    .join("\n\n") + "\n";
}

/**
 * Serialize a config object to YAML, filtering internal / read-only keys.
 *
 * Default policy (round-trip-safe, used by the editable config editors): strip
 * only `id`, preserve key order, `lineWidth: -1`. Call sites that render a
 * read-only or partial-update view can pass `hiddenKeys` / `stripUnderscore` /
 * `sortKeys` to hide more.
 */
export function configToYaml(
  config: Record<string, unknown>,
  opts: ConfigToYamlOptions = {},
): string {
  const {
    hiddenKeys = [],
    stripUnderscore = false,
    sortKeys = false,
    groupSections = false,
  } = opts;
  const hidden = new Set<string>([...ALWAYS_HIDDEN_KEYS, ...hiddenKeys]);
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (hidden.has(k)) continue;
    if (stripUnderscore && k.startsWith("_")) continue;
    filtered[k] = v;
  }
  if (groupSections) return dumpGroupedYaml(filtered, sortKeys);
  return yaml.dump(filtered, { lineWidth: -1, noRefs: true, sortKeys });
}
