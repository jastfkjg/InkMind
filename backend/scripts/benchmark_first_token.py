#!/usr/bin/env python3
"""
对比 Qwen / DeepSeek / MiniMax / Kimi(Moonshot) 在流式调用下的首 token 耗时（TTFT）。

在 backend 目录执行，并加载 backend/.env：

  cd backend && python scripts/benchmark_first_token.py

所需环境变量（缺 key 的厂商会跳过）：

  Qwen:     QWEN_API_KEY；可选 QWEN_BASE_URL；若 BENCHMARK_MODELS["qwen"] 非空则不读 QWEN_MODEL
  DeepSeek: DEEPSEEK_API_KEY；可选 DEEPSEEK_BASE_URL；同上
  MiniMax:  MINIMAX_API_KEY；可选 MINIMAX_BASE_URL；同上
  Kimi:     MOONSHOT_API_KEY 或 KIMI_API_KEY；可选 MOONSHOT_BASE_URL；同上

多模型列表见本文件 BENCHMARK_MODELS；某厂商列表非空时仅用列表内 model，不读该厂商的 *_MODEL。

指标说明：
  create_ms  : 从发起 chat.completions.create 到返回 stream 对象（含建连/握手）
  ttfb_ms    : 从 create 开始到收到第一个非空 delta 正文（首 token，含服务端 prefill）
  二者均无法拆分云厂商内部 prefill，仅作客户端可观测延迟
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, replace
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

# ---------------------------------------------------------------------------
# 同厂商多模型对比：在此填写要测的 model 字符串（OpenAI 兼容接口的 model 字段）。
# - 某厂商有非空列表时：只跑列表中的模型，不使用环境变量里的 *_MODEL。
# - 留空列表 [] 或未出现在此字典中：该厂商只跑 1 次，模型名来自对应 *_MODEL（与主应用一致）。
# ---------------------------------------------------------------------------
BENCHMARK_MODELS: dict[str, list[str]] = {
    "kimi": ["moonshot-v1-32k", "kimi-k2.5"],
    "qwen": ["qwen3.5-flash", "qwen3-max", "qwen3.6-plus"],
    "deepseek": ["deepseek-chat"],
    "minimax": ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5-highspeed"],
}


def resolve_models_for_benchmark(provider_key: str, base: ProviderCfg) -> list[str]:
    """返回本次要测的模型名列表（顺序与 BENCHMARK_MODELS 一致）。"""
    names = BENCHMARK_MODELS.get(provider_key)
    if names:
        return list(names)
    return [base.model]


def benchmark_chat_temperature(cfg: ProviderCfg) -> float | None:
    """与 app.llm.openai_llm.KimiLLM._chat_temperature 规则对齐（benchmark 默认 0.7）。"""
    if not cfg.send_temperature:
        return None
    if cfg.name == "kimi" and cfg.model.lower().startswith("kimi-k2"):
        return 1.0
    return 0.7


@dataclass
class ProviderCfg:
    name: str
    api_key: str
    base_url: str
    model: str
    send_temperature: bool = True


def _bool_env(key: str, default: bool) -> bool:
    v = os.getenv(key)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def load_provider_configs() -> dict[str, ProviderCfg | None]:
    """只读环境变量；未配置 key 的返回 None。"""
    out: dict[str, ProviderCfg | None] = {}

    if os.getenv("QWEN_API_KEY"):
        out["qwen"] = ProviderCfg(
            name="qwen",
            api_key=os.environ["QWEN_API_KEY"],
            base_url=os.getenv(
                "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
            ),
            model=os.getenv("QWEN_MODEL", "qwen-turbo"),
            send_temperature=_bool_env("QWEN_SEND_TEMPERATURE", True),
        )
    else:
        out["qwen"] = None

    if os.getenv("DEEPSEEK_API_KEY"):
        out["deepseek"] = ProviderCfg(
            name="deepseek",
            api_key=os.environ["DEEPSEEK_API_KEY"],
            base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            send_temperature=_bool_env("DEEPSEEK_SEND_TEMPERATURE", True),
        )
    else:
        out["deepseek"] = None

    minimax_key = os.getenv("MINIMAX_API_KEY")
    if minimax_key:
        out["minimax"] = ProviderCfg(
            name="minimax",
            api_key=minimax_key,
            base_url=os.getenv("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
            model=os.getenv("MINIMAX_MODEL", "MiniMax-M2"),
            send_temperature=_bool_env("MINIMAX_SEND_TEMPERATURE", True),
        )
    else:
        out["minimax"] = None

    moon_key = os.getenv("MOONSHOT_API_KEY") or os.getenv("KIMI_API_KEY")
    if moon_key:
        out["kimi"] = ProviderCfg(
            name="kimi",
            api_key=moon_key,
            base_url=os.getenv("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1"),
            model=os.getenv("MOONSHOT_MODEL", "moonshot-v1-8k"),
            send_temperature=_bool_env("MOONSHOT_SEND_TEMPERATURE", True),
        )
    else:
        out["kimi"] = None

    return out


def measure_stream_ttfb(
    cfg: ProviderCfg,
    *,
    system: str,
    user: str,
    timeout: float = 120.0,
) -> dict[str, Any]:
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_url, timeout=timeout)

    payload: dict[str, Any] = {
        "model": cfg.model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": True,
    }
    t_req = benchmark_chat_temperature(cfg)
    if t_req is not None:
        payload["temperature"] = t_req

    t_create_start = time.perf_counter()
    stream = client.chat.completions.create(**payload)
    t_create_end = time.perf_counter()

    first_content_time: float | None = None
    chunks = 0
    for chunk in stream:
        chunks += 1
        choice = chunk.choices[0] if chunk.choices else None
        if not choice:
            continue
        delta = choice.delta
        if delta is None:
            continue
        content = getattr(delta, "content", None)
        if content and first_content_time is None:
            first_content_time = time.perf_counter()
        # 继续读完流，避免连接半开

    create_ms = (t_create_end - t_create_start) * 1000.0
    if first_content_time is None:
        return {
            "provider": cfg.name,
            "model": cfg.model,
            "create_ms": round(create_ms, 2),
            "ttfb_ms": None,
            "error": "no non-empty delta in stream",
            "chunks_seen": chunks,
        }

    ttfb_ms = (first_content_time - t_create_start) * 1000.0
    return {
        "provider": cfg.name,
        "model": cfg.model,
        "create_ms": round(create_ms, 2),
        "ttfb_ms": round(ttfb_ms, 2),
        "chunks_to_first_token": chunks,
    }


def main() -> None:
    # 从 backend 目录运行时加载 .env
    load_dotenv()

    parser = argparse.ArgumentParser(description="首 token 延迟（TTFT）对比")
    parser.add_argument(
        "--system",
        default="你是一个简洁助手，用中文回答。",
        help="system 提示",
    )
    parser.add_argument(
        "--user",
        "--prompt",
        dest="user",
        default="用一句话介绍你自己。",
        help="user 消息（测试 prompt）",
    )
    parser.add_argument(
        "--providers",
        nargs="*",
        choices=["qwen", "deepseek", "minimax", "kimi"],
        help="要测的厂商，默认全部（有 key 的）",
    )
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args()

    all_cfg = load_provider_configs()
    want = set(args.providers) if args.providers else set(all_cfg.keys())

    rows: list[dict[str, Any]] = []
    for key in ("qwen", "deepseek", "minimax", "kimi"):
        if key not in want:
            continue
        cfg = all_cfg.get(key)
        if cfg is None:
            rows.append(
                {
                    "provider": key,
                    "model": "-",
                    "create_ms": None,
                    "ttfb_ms": None,
                    "error": "未配置 API Key，已跳过",
                }
            )
            continue
        for model in resolve_models_for_benchmark(key, cfg):
            run_cfg = replace(cfg, model=model)
            try:
                r = measure_stream_ttfb(run_cfg, system=args.system, user=args.user)
                rows.append(r)
            except Exception as e:
                rows.append(
                    {
                        "provider": key,
                        "model": model,
                        "create_ms": None,
                        "ttfb_ms": None,
                        "error": str(e),
                    }
                )

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return

    print(f"prompt (user): {args.user!r}\n")
    print(f"{'provider':<12} {'model':<28} {'create_ms':>12} {'ttfb_ms':>12}  note")
    print("-" * 90)
    for r in rows:
        p = r.get("provider", "?")
        m = str(r.get("model", "-"))[:28]
        cm = r.get("create_ms")
        tm = r.get("ttfb_ms")
        err = r.get("error")
        note = err or ""
        cm_s = f"{cm:>10.2f}" if isinstance(cm, (int, float)) else f"{'-':>12}"
        tm_s = f"{tm:>10.2f}" if isinstance(tm, (int, float)) else f"{'-':>12}"
        print(f"{p:<12} {m:<28} {cm_s:>12} {tm_s:>12}  {note}")
    print()
    print("create_ms: create() 返回 stream 的耗时；ttfb_ms: 从 create 开始到首个正文 delta。")


if __name__ == "__main__":
    sys.exit(main() or 0)


"""
2026/04/15 Benchmark Result 1:
provider     model                           create_ms      ttfb_ms  note
------------------------------------------------------------------------------------------
qwen         qwen3.5-flash                     1726.64      7676.66  
qwen         qwen3-max                          401.68       402.46  
qwen         qwen3.6-plus                       648.13     10332.81  
deepseek     deepseek-chat                      163.37      1136.55  
minimax      MiniMax-M2.7                      2449.52      2450.33  
minimax      MiniMax-M2.7-highspeed            4937.82      4938.63  
minimax      MiniMax-M2.5-highspeed            1233.04      1233.56  
kimi         moonshot-v1-32k                         -            -  Connection error.
kimi         kimi-k2.5                               -            -  Connection error.

2026/04/15 Benchmark Result 2:
provider     model                           create_ms      ttfb_ms  note
------------------------------------------------------------------------------------------
qwen         qwen3.5-flash                      286.66      5930.48  
qwen         qwen3-max                          686.78       687.87   ***
qwen         qwen3.6-plus                      3814.06     18700.05  
deepseek     deepseek-chat                      134.04      1706.01   *
minimax      MiniMax-M2.7                      3081.54      3082.34  
minimax      MiniMax-M2.7-highspeed            5037.85      5038.21  
minimax      MiniMax-M2.5-highspeed             672.36       672.52   **
kimi         moonshot-v1-32k                    689.51       689.77   **
kimi         kimi-k2.5                         8715.01     15374.12 
"""
