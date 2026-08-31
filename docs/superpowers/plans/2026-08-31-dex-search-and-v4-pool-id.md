# DEX 搜索与 Uniswap v4 池 ID 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 DEX 页面可以按名称、符号和地址搜索，并能打开 Uniswap v4 的 32 字节池 ID。

**Architecture:** 保留现有 GeckoTerminal 请求总入口、缓存和并发合并。代币地址继续走精确的代币池接口，文本与池 ID 走通用池搜索；池详情增加“搜索时允许未命中”的只读模式，详情页仍保留明确的 404。

**Tech Stack:** Python、FastAPI、React、TypeScript、TanStack Query、pytest、Vite。

## Global Constraints

- 文档和新增说明使用中文。
- 不写死 MICRODUCK、Robinhood Chain 或某个资金池。
- 保留前端 400 毫秒等待、后端缓存及 GeckoTerminal 限流保护。
- 不修改交易策略、钱包和机器人运行状态。
- 不删除重要文件。

---

### Task 1: 区分代币地址和资金池 ID

**Files:**
- Modify: `condor/dex_candles.py`
- Modify: `condor/pool_data.py`
- Modify: `condor/web/routes/dex.py`
- Modify: `condor/web/routes/market.py`
- Test: `tests/test_dex_pool_discovery.py`
- Test: `tests/test_dex_candles.py`

**Interfaces:**
- Consumes: 现有 `ADDRESS_RE`，继续表示普通 EVM 地址或 Solana 地址。
- Produces: `POOL_ADDRESS_RE`，额外接受 `0x` 加 64 个十六进制字符的 Uniswap v4 池 ID。

- [ ] **Step 1: 写入失败测试**

```python
V4_POOL = "0x" + "ab" * 32
assert dex_candles.POOL_ADDRESS_RE.fullmatch(V4_POOL)
assert route_client().get(f"/servers/srv/dex/pools/{V4_POOL}").status_code == 200
```

- [ ] **Step 2: 运行测试并确认旧代码失败**

Run: `.venv/bin/pytest tests/test_dex_pool_discovery.py tests/test_dex_candles.py -q`
Expected: v4 池 ID 被旧正则拒绝。

- [ ] **Step 3: 增加并接入池地址正则**

```python
ADDRESS_RE = re.compile(r"^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$")
POOL_ADDRESS_RE = re.compile(
    r"^(0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})|[1-9A-HJ-NP-Za-km-z]{32,44})$"
)
```

- [ ] **Step 4: 运行地址与池详情测试**

Run: `.venv/bin/pytest tests/test_dex_pool_discovery.py tests/test_dex_candles.py -q`
Expected: PASS。

### Task 2: 恢复名称和符号搜索

**Files:**
- Modify: `condor/pool_data.py`
- Modify: `condor/web/routes/dex.py`
- Test: `tests/test_dex_pool_discovery.py`

**Interfaces:**
- Consumes: `list_gecko_pools_page(network, view, token, limit, page, dexes)`。
- Produces: 当 `view="token"` 且查询不是代币地址时，通过 `search/pools` 返回当前网络的标准化池列表。

- [ ] **Step 1: 写入失败测试**

```python
result = run(pool_data.list_gecko_pools_page("ethereum-robinhoodchain", view="token", token="microduck"))
assert result["pools"][0]["base_symbol"] == "MICRODUCK"
```

- [ ] **Step 2: 确认旧代码返回空结果或 400**

Run: `.venv/bin/pytest tests/test_dex_pool_discovery.py -q`
Expected: 名称搜索测试失败。

- [ ] **Step 3: 对文本查询复用 `search/pools`**

```python
if view == "token" and not ADDRESS_RE.fullmatch(token):
    payload = await gecko_request(
        "GET", "search/pools", params={"query": token, "network": gnet, "page": page}
    )
    rows = [_flatten_search_pool(row) for row in payload.get("data") or []]
```

- [ ] **Step 4: 运行 DEX 发现测试**

Run: `.venv/bin/pytest tests/test_dex_pool_discovery.py -q`
Expected: PASS。

### Task 3: 消除搜索过程中的误导性 404

**Files:**
- Modify: `condor/web/routes/dex.py`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/Dex.tsx`
- Modify: `frontend/src/components/dex/PoolSourceTabs.tsx`
- Test: `tests/test_dex_pool_discovery.py`

**Interfaces:**
- Consumes: `GET /servers/{name}/dex/pools/{pool_address}`。
- Produces: 可选参数 `soft=true`；搜索页未命中返回 `200 null`，详情页未命中仍返回 `404`。

- [ ] **Step 1: 写入软查询路由测试**

```python
r = route_client().get(f"/servers/srv/dex/pools/{POOL}?soft=true")
assert r.status_code == 200
assert r.json() is None
```

- [ ] **Step 2: 增加软查询参数并保持详情语义**

```python
if not pool:
    if soft:
        return None
    raise HTTPException(status_code=404, detail="Pool not found")
```

- [ ] **Step 3: 前端启用非空文本搜索并使用软池查询**

```ts
const enabled = !!server && source.kind !== "favorites" && (!isSearch || !!debouncedQuery);
api.getDexPoolByAddress(server!, debouncedQuery, network, true);
```

- [ ] **Step 4: 更新输入提示和空结果说明**

```tsx
placeholder="Search by name, symbol, token or pool address…"
```

- [ ] **Step 5: 运行后端测试和前端构建**

Run: `.venv/bin/pytest tests/test_dex_pool_discovery.py tests/test_dex_candles.py -q`
Expected: PASS。

Run: `npm run build --prefix frontend`
Expected: 构建成功。

### Task 4: 真实环境验证与提交

**Files:**
- Verify: `frontend/src/pages/Dex.tsx`
- Verify: `condor/web/routes/dex.py`

**Interfaces:**
- Consumes: 已登录的本机 Condor 页面和正在运行的服务。
- Produces: 名称、合约地址、v4 池 ID 三条真实验证结果。

- [ ] **Step 1: 重启 Condor 服务以加载后端修改**

Run: 结束当前 `uv run --project /Users/justaman/Documents/code/finance/microduck/condor-stack/condor python main.py` 进程，然后在同一目录按相同命令启动，标准输出继续写入 `logs/launchd.out.log`，错误输出继续写入 `logs/launchd.err.log`；不停止交易机器人容器。
Expected: `http://127.0.0.1:24871/` 恢复可访问。

- [ ] **Step 2: 在 DEX 页面搜索 `microduck` 和合约地址**

Expected: 两种输入均显示 MICRODUCK 资金池，网络面板不再出现池详情 404。

- [ ] **Step 3: 打开一个 66 位 Uniswap v4 池 ID**

Expected: 详情请求不再返回 400，页面显示池信息或明确的上游限流提示。

- [ ] **Step 4: 检查改动量并提交**

```bash
git diff --check
git diff --stat
git add condor frontend tests docs/superpowers/plans/2026-08-31-dex-search-and-v4-pool-id.md
git commit -m "fix: restore DEX search and v4 pool details"
```
