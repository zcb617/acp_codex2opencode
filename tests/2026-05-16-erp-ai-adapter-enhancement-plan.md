# ERP 销售单据 AI 适配层开发计划

- 文档版本：v1.0
- 编写日期：2026-05-16
- 项目：`erp-hy-java`
- 计划类型：新增功能（Feature）
- 方案来源：`D:\zhangcb\my_wiki\coding\erp_cj\erp-hy-java\docs\superpowers\specs\2026-05-16-erp-ai-adapter-enhancement-design.md`

## 1. 项目与目标

本计划用于交付销售单据 AI 适配层 MVP，聚焦毛坯短管场景的两条链路：
1. 新增订单：`SaleOrderAction.createCPOrder`（`sale/customproduct/order/add`，按订单头+明细保存）
2. 修改明细：`SaleOrderAction.modifyOrderDetail`（`sale/customproduct/order/detailupdate`，按订单明细行更新）

业务目标：
1. 降低销售内勤/跟单在建单与改单过程中的手工补录成本。
2. 将“客户未匹配、商品未匹配、交期缺失、库存不足”等异常转为可回流补全任务。
3. 保障会话中断后可续接，第二次请求可沿原 `sessionId/taskId` 继续，不重建流程。

本计划不处理导入、删除和跨模块联动流程。

## 2. 硬约束

执行本计划必须遵守以下约束：
1. 所有文档与沟通使用中文。
2. 修改代码前先汇报实施方案并获得用户批准。
3. 仅当评估改动量大于 3 个文件时新建分支，并在分支上开发。
4. 每个任务完成后必须提交 commit，防止后续不可回滚。
5. 未经用户授权不得执行 `git push`。
6. AI 适配层不得绕过 `ISaleOrderService` 直接落订单主数据。
7. 本期范围仅新增与修改，不允许在执行中扩展导入/删除能力。

## 3. 范围与非范围

### 3.1 本次交付范围

1. 新增 AI 入口接口：草稿、反馈、校验、确认、状态/续接。
2. 新增 AI 会话状态机与任务续接协议（`sessionId/taskId/resumeToken`）。
3. 新增异常转译机制：把后端异常统一映射为 `requiredPatch/options/nextAction`。
4. 复用现有新增接口链路：`createCPOrder -> createSaleOrder`。
5. 复用现有修改接口链路：`detailupdate -> modifySaleOrderDetail -> updateSaleOrderDetail`。
6. 补齐幂等与并发控制：`idempotencyKey` + `confirm` 互斥锁。
7. 完成新增/修改分开设计的交付测试，并附通过判定标准。

### 3.2 本次非范围

1. 导入（`importFile`、批量导入）能力。
2. 删除（`removeOrder/removeOrderDetail`）能力。
3. 订单审批流、生产/采购联动链路。
4. 模型路由、多 Agent 自动编排。

## 4. 交付完成定义

仅当以下条件同时满足，才可声明本次交付完成：
1. 新增与修改两条链路均可从真实入口跑通（含异常分支）。
2. 所有已识别异常控制点可回流至用户补全并成功续接。
3. 新增链路落库粒度保持订单级，修改链路保持明细级，不发生误改。
4. 同会话重复提交不产生重复订单，幂等与互斥策略生效。
5. 交付测试矩阵（`DT-CREATE-*`、`DT-UPDATE-*`）全量通过。
6. 失败场景完成根因修复并复测通过，失败记录闭环留痕。

## 5. 业务交付场景（真实入口）

### 5.1 新增链路场景

1. `DS-CREATE-01` 正常新增：AI 补全客户/产品/数量/交期，库存预检通过，人工确认后成功落单。
2. `DS-CREATE-02` 明细为空：触发新增前校验失败，回流补全明细后续接。
3. `DS-CREATE-03` 客户不存在：回流客户补全，补全后按原任务续接成功。
4. `DS-CREATE-04` 产品不存在：回流产品补全，补全后从失败步骤继续。
5. `DS-CREATE-05` 交期缺失：触发交期必填异常，补全后进入可校验状态。
6. `DS-CREATE-06` 库存不足：返回减量/拆单/改期建议，补全后二次校验通过。
7. `DS-CREATE-07` 重复确认：同会话重复提交仅允许一笔真实落单。

### 5.2 修改链路场景

1. `DS-UPDATE-01` 正常改单：按明细 ID 更新，非目标明细保持不变。
2. `DS-UPDATE-02` 明细不存在：回流重新选择明细，不产生误更新。
3. `DS-UPDATE-03` 修改触发库存冲突：回流调整数量/交期，再次提交成功。
4. `DS-UPDATE-04` 中断续接：第一次中断后，第二次通过 `status/continue` 恢复并完成。
5. `DS-UPDATE-05` 粒度边界：验证修改接口仅更新指定明细，不触发整单重建。

## 6. 自测命令

交付前至少执行以下命令（按仓库 Maven 结构）：

```bash
mvn -pl steel,manufacturing-service,manufacturing-dao -am clean test
mvn -pl steel,manufacturing-service,manufacturing-dao -am -DskipTests compile
```

通过标准：
1. 编译成功，无新增编译错误。
2. 与 AI 适配层相关单测/集成测试通过。
3. 业务交付测试矩阵通过（真实入口验证，不以单测替代）。

## 7. 失败修复与复测机制

任一测试失败时，必须执行以下闭环：
1. 记录失败场景、输入、期望、实际、影响范围、首次出现版本。
2. 基于日志与数据库快照定位根因，不把日志分析责任转交用户。
3. 提交修复代码并关联失败记录。
4. 先复测失败用例，再回归全量 `DT-CREATE-*`/`DT-UPDATE-*`。
5. 全量通过前不得声明完成。

失败记录模板：

```markdown
# 问题名称
## 失败场景
## 输入数据
## 期望结果
## 实际结果
## 根因分析
## 修复方案
## 复测命令
## 复测结果
```

## 8. 技术设计与模块边界（实施视角）

### 8.1 模块划分

1. `steel` Action 层
- 新增 `AiSaleOrderAction`（建议路径：`steel/.../action/ai`）
- 负责会话入口、参数校验、鉴权、响应封装

2. `manufacturing-service` 服务层
- 新增 `AiSaleOrderService`、`AiPromptService`、`AiErrorMapper`
- 负责语义映射、状态推进、异常转译、续接编排

3. `manufacturing-dao` 数据层
- 新增 AI 会话/事件/幂等 DAO 与 Mapper
- 负责 `STEEL_AI_ORDER_SESSION/EVENT/IDEMPOTENCY_RECORD` 持久化

4. 复用现有销售服务
- `ISaleOrderService.createSaleOrder`
- `ISaleOrderService.modifySaleOrderDetail`
- `ISaleOrderService.checkInventory`

### 8.2 调用边界

允许：
`AiSaleOrderAction -> AiSaleOrderService -> ISaleOrderService + AiSessionDao`

禁止：
1. `AiSaleOrderAction -> 销售订单DAO` 直写。
2. `AiSaleOrderService` 绕开 `ISaleOrderService` 直接落订单表。
3. 由模型直接裁决库存与事务结果。

### 8.3 数据流（新增/修改共性）

`start/draft` -> 语义解析 -> 缺槽位检测 -> `WAIT_USER_PATCH`  
`continue/feedback` -> 补丁合并 -> 从失败步骤续接 -> `validate`  
`validate` -> 规则校验/库存校验 -> `READY_CONFIRM`  
`confirm` -> 调用新增或修改真实入口 -> 写事件 -> 返回业务结果

## 9. API、数据模型与配置

### 9.1 计划内 API

1. `POST /sys/ai/sale/order/draft`：创建或续写草稿。
2. `POST /sys/ai/sale/order/feedback`：补全缺失字段。
3. `POST /sys/ai/sale/order/validate`：业务预校验（含库存）。
4. `POST /sys/ai/sale/order/confirm`：人工确认后提交。
5. `POST /sys/ai/sale/order/status`：恢复会话状态。
6. `POST /sys/ai/sale/order/continue`：按 `resumeToken` 续接任务。

### 9.2 数据模型

1. `STEEL_AI_ORDER_SESSION`：会话状态、草稿、最近失败点。
2. `STEEL_AI_ORDER_EVENT`：请求/响应快照与耗时审计。
3. `STEEL_AI_IDEMPOTENCY_RECORD`：幂等键、请求哈希、响应快照。

### 9.3 关键配置

1. `ai.sale.order.enabled`
2. `ai.model.name`
3. `ai.request.timeout.ms`
4. `ai.session.ttl.hours`
5. `ai.rate.limit.*`
6. `ai.idempotency.ttl.hours`

### 9.4 安全配置修正

1. 收敛 `/sys/ai/sale/order/*` 登录拦截，不允许匿名提交。
2. 保留内部 `debugMessage` 追溯字段，外部仅暴露结构化错误码与补全项。

## 10. 开发任务拆分

### 10.1 Task-01：AI 入口与 DTO 契约

- 目标：落地 `draft/feedback/validate/confirm/status/continue` 接口契约。
- 主要改动：
1. 新增 Action 类与请求/响应 DTO。
2. 接入统一响应包装与鉴权。
- 完成标准：
1. 接口可被测试调用。
2. 参数错误返回统一业务错误码。

### 10.2 Task-02：会话状态机与续接引擎

- 目标：实现 `sessionId/taskId/resumeToken` 驱动的可续接流程。
- 主要改动：
1. 状态机迁移实现（`WAIT_USER_PATCH`/`READY_VALIDATE`/`READY_CONFIRM` 等）。
2. `continue` 仅重放失败步骤与后续步骤。
- 完成标准：
1. 中断后可通过 `status/continue` 恢复。
2. 不发生“从头重建流程”。

### 10.3 Task-03：异常转译与补全回流

- 目标：把现有异常映射为可执行补全任务。
- 主要改动：
1. 建立 `AiErrorMapper`（产品未匹配、客户未匹配、交期缺失、库存不足等）。
2. 响应补全结构：`requiredPatch/options/nextAction`。
- 完成标准：
1. 异常返回结构化响应。
2. 每个异常都有明确补全入口。

### 10.4 Task-04：新增/修改业务桥接

- 目标：与现有服务桥接，保持原业务语义。
- 主要改动：
1. 新增路径桥接 `createCPOrder/createSaleOrder`。
2. 修改路径桥接 `detailupdate/modifySaleOrderDetail/updateSaleOrderDetail`。
- 完成标准：
1. 新增保持订单级写入。
2. 修改保持明细级更新。

### 10.5 Task-05：幂等、并发与审计

- 目标：保障重复请求和并发提交安全。
- 主要改动：
1. 幂等记录表与校验逻辑。
2. `confirm` 锁与重复提交处理。
3. 事件审计落库。
- 完成标准：
1. 同会话重复确认不重复落单。
2. 审计证据可追溯。

### 10.6 Task-06：测试与交付验证

- 目标：完成单测、集成测试与业务交付测试矩阵。
- 主要改动：
1. 新增测试夹具与场景数据。
2. 执行 `DT-CREATE-*` 与 `DT-UPDATE-*` 全量验证。
- 完成标准：
1. 用例全通过。
2. 失败闭环记录完整。

## 11. 测试策略

### 11.1 单元测试

1. 语义映射规则。
2. 状态迁移合法性。
3. 异常映射正确性。
4. 幂等冲突判定。

### 11.2 集成测试

1. AI 服务与现有销售服务联调。
2. 会话/事件/幂等落库一致性。
3. Redis 锁互斥与超时回收。

### 11.3 交付测试矩阵（核心）

1. 新增流程：`DT-CREATE-01` 至 `DT-CREATE-07`。
2. 修改流程：`DT-UPDATE-01` 至 `DT-UPDATE-05`。
3. 每个用例必须提交四类证据：
- 请求报文
- 响应报文
- 数据库前后快照
- 会话事件日志

### 11.4 通过门槛

1. 全量矩阵逐项通过；任一项失败整体不通过。
2. 不允许以内部函数直调替代真实业务入口测试。
3. 不允许以“代码已完成”替代交付测试结论。

## 12. 需求到验收映射

| 需求点 | 计划任务 | 交付用例 | 通过标准摘要 |
|---|---|---|---|
| 新增订单 AI 辅助 | Task-01/04 | DT-CREATE-01 | 按订单级成功落库 |
| 修改明细 AI 辅助 | Task-01/04 | DT-UPDATE-01/05 | 仅目标明细更新 |
| 客户/产品缺失异常回流 | Task-03 | DT-CREATE-03/04 | 返回补全任务并可续接 |
| 交期与库存异常处理 | Task-03/04 | DT-CREATE-05/06、DT-UPDATE-03 | 异常可修复后继续提交 |
| 会话中断后续接 | Task-02 | DT-UPDATE-04 | 复用原会话并从失败步骤继续 |
| 防重复提交 | Task-05 | DT-CREATE-07 | 最多一笔真实订单 |

## 13. 最终交付清单

1. 计划文档：`docs/superpowers/plans/2026-05-16-erp-ai-adapter-enhancement-plan.md`
2. 代码交付（后续实施阶段产出）：
- AI 入口 Action 与 DTO
- AI 服务、异常映射、续接引擎
- AI 会话/事件/幂等 DAO 与表结构迁移
- 测试代码与测试数据
3. 交付测试证据包：
- 新增与修改用例执行记录
- 关键数据库快照与差异对比
- 失败修复与复测记录

## 14. 实施节奏与里程碑

1. M1（D+1）：完成接口骨架、会话模型与基础状态机。
2. M2（D+2）：完成新增/修改桥接与异常回流。
3. M3（D+3）：完成幂等并发控制与审计链路。
4. M4（D+4）：完成测试、交付验证与修复闭环。

## 15. 风险与应对

1. 风险：`createSaleOrder` 内部库存校验未强制。  
应对：AI `confirm` 前强制执行 `validate/checkInventory`，并在测试覆盖库存边界。

2. 风险：`/sys/ai/**` 免拦截导致越权调用。  
应对：调整登录拦截策略，对 AI 下单入口强制鉴权。

3. 风险：异常文本不稳定导致映射偏差。  
应对：优先以异常类型+控制点映射，字符串仅做兜底。

4. 风险：多轮补全造成上下文污染。  
应对：每次补全写事件快照并绑定 `resumeToken` 单次消费。
