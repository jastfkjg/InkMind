# 网页额度包与支付宝收款

收费默认关闭。`BILLING_ENABLED=false`、桌面模式和自带 API Key 保持原有行为；桌面不展示商城，自带 Key 不占用或扣除平台额度。已有支付订单在关闭购买后仍可查询。

## 本地沙箱体验

先按 `INSTALL.md` 安装后端和前端依赖，并完成 Skill 的沙箱配置流程。沙箱配置保留在 `backend/.alipay-sandbox.json`，权限须为 0600，禁止提交、复制到源码或打印密钥。

运行 `bash start-payment-sandbox.sh`；若依赖安装在其他虚拟环境，通过 `INKMIND_SANDBOX_PYTHON` 指定 Python 绝对路径。浏览器打开 `http://127.0.0.1:5173/usage`，注册或登录此测试实例的 InkMind 账号，选择沙箱体验额度包，在新开的支付宝沙箱收银台完成付款，随后在用量页查询订单。

本入口强制使用沙箱网关、临时目录中的独立 SQLite 数据库和测试额度包，监听本机回环地址；不会改动原有数据库。测试价格不是正式商品价格。买家实际付款须本人在收银台完成；无公网 HTTPS 通知时，以服务端交易查询确认结果。不要把付款回跳参数或页面文字当作付款依据。

## 正式启用

以单个 Uvicorn worker 运行当前 SQLite 和助手会话代理，支付宝 SDK 请求时间戳使用系统时区，部署设置 `TZ=Asia/Shanghai`。配置真实服务条款、退款联系邮箱、额度包和可计费模型，再设置 `BILLING_ENABLED=true`。服务启动时验证配置，不完整会阻止启动。示例只是配置结构，正式价格和倍率须由运营方确认：

```dotenv
BILLING_ENABLED=false
ALIPAY_SANDBOX=false
ALIPAY_APP_ID=正式应用ID
ALIPAY_SELLER_ID=正式收款方ID
ALIPAY_PRIVATE_KEY_PATH=/受保护目录/应用私钥
ALIPAY_PUBLIC_KEY_PATH=/受保护目录/支付宝公钥
ALIPAY_NOTIFY_URL=https://你的域名/api/billing/notify
ALIPAY_RETURN_URL=https://你的域名/api/billing/return
BILLING_FRONTEND_URL=https://你的域名/usage
BILLING_AGENT_PROXY_BASE_URL=http://127.0.0.1:8000/billing/agent-proxy
BILLING_TERMS_URL=https://你的域名/服务条款
BILLING_SUPPORT_EMAIL=你的退款联系邮箱
```

`BILLING_PACKAGES` 是 JSON 数组，每项包含 `id`、`name`、可选 `name_en`、整数 `amount_cents` 和整数 `credits`；金额按人民币分保存，额度为平台计费单位。`BILLING_MODELS` 是 JSON 数组，每项包含 `provider`、`model`、正数 `input_rate` 和 `output_rate`，表示每个输入、输出 Token 扣除的额度单位。助手模型还应配置实际厂商的 `usd_per_million_input`、`usd_per_million_output`，供助手预算限制使用。不要把示例价格当作实时厂商报价。

生产私钥与支付宝公钥用权限受限的绝对路径文件，使用官方工具输出的原始字符串，不增加 PEM 头尾。生产禁止回退到沙箱配置；金额、额度及收款身份均由服务端决定。生产必须配置并实际联调公网 HTTPS 异步通知，然后检查验签、金额和收款身份、重复通知、退款通知以及 `success` 回写。

## 计费与核对

普通生成、改写、评估、后台任务通过 `MeteredLLM` 逐次预占；内置助手的每次模型请求通过本机计费代理预占。付款后增加总额度，发起平台模型请求前从可用额度预占输入上限与输出上限，结束后按厂商返回的可信 usage 和请求时快照倍率结算并释放差额。缓存输入按厂商报告的输入口径计入。尚未配置价格或无法提供可信 usage 的平台模型不允许在收费模式使用，自带 Key 仍可使用。

并发请求通过数据库事务锁定同一账号，预占持久化，避免透支。断线、异常、缺失 usage 或进程重启不会自动返还不明用量，而将预占保留为 `interrupted`，供核对。管理员在 `GET /billing/admin/reservations` 查看未结算请求，取得可信用量后调用 `POST /billing/admin/reservations/{id}/reconcile`，提交 `input_tokens`、`output_tokens` 和核对原因；明确未产生用量才能按 0 核销。

`LLMUsageEvent` 保存原始输入/输出 Token 和本次 `billing_credits`，额度统计优先使用计费单位；历史事件沿用原 Token 口径。`CreditLedger` 保存购买、消耗、退款扣回明细，`GET /billing/ledger` 返回当前用户流水；预占快照关联实际模型和调用动作，支付宝通知持久化且幂等。

第一版只支持整包未使用的全额退款。管理员通过 `POST /billing/admin/orders/{id}/refund` 退款，额度先冻结且全程复用同一个退款请求号；结果不明时通过 `/refund-query` 查询，禁止重新创建退款单。存在已使用额度或活动预占时不允许退款。每个购买、消耗及退款都能关联订单或预占记录，退款事件不会重复发放额度。
