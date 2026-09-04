export interface ConfigDisplayInfo {
  name: string;
  description: string;
  tooltip: string;
}

const KNOWN_CONFIGS: Record<string, { name: string; description: string }> = {
  microduck_012_013_profit50_observe: {
    name: "MICRODUCK 自动买卖",
    description: "等待价格进入买入范围，按反弹规则买入，再按利润目标和回落规则卖出。",
  },
  microduck_external_01: {
    name: "MICRODUCK 外部持仓管理 01",
    description: "管理在 Uniswap 等其他地方已经买入的持仓；导入后部署，将从等待卖出开始。",
  },
};

export function configDisplayInfo(configId: string): ConfigDisplayInfo {
  const known = KNOWN_CONFIGS[configId];
  const name = known?.name ?? "自定义策略配置";
  const description = known?.description ?? "使用这份配置创建并运行独立的 Bot。";
  return {
    name,
    description,
    tooltip: `原配置名：${configId}\n作用：${description}`,
  };
}
