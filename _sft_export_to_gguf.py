"""
Merge a trained LoRA adapter into the base Qwen3-4B-Instruct model and
export the merged result as a Q4_K_M GGUF file for llama-server serving
on edge hardware.

Pipeline:
    base_model + adapter  ->  merged HF model  ->  GGUF (Q4_K_M)

Usage:
    python _sft_export_to_gguf.py \\
        --base_model unsloth/Qwen3-4B-Instruct-2507 \\
        --adapter adapters/qwen3_4b_v35_run1 \\
        --output cache/models/Qwen3-4B-v35-SFT-Q4_K_M.gguf

The output GGUF can be served immediately with:
    llama-server -m cache/models/Qwen3-4B-v35-SFT-Q4_K_M.gguf \\
                 -ngl 99 -c 16384 --parallel 1 \\
                 --host 127.0.0.1 --port 6969
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base_model", default="unsloth/Qwen3-4B-Instruct-2507")
    ap.add_argument("--adapter", required=True, help="Trained adapter directory")
    ap.add_argument("--output", required=True, help="Output GGUF path")
    ap.add_argument("--quantization", default="q4_k_m",
                    choices=["q4_k_m", "q5_k_m", "q6_k", "q8_0", "f16"],
                    help="GGUF quantization level")
    ap.add_argument("--max_seq_length", type=int, default=4096)
    return ap.parse_args()


def main():
    args = parse_args()
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Loading base + adapter via unsloth...")
    from unsloth import FastLanguageModel
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=args.max_seq_length,
        load_in_4bit=False,                 # need full-precision base for merge
        dtype=None,
    )
    model.load_adapter(args.adapter, adapter_name="trained")
    model.set_adapter("trained")

    print(f"\nMerging LoRA into base + exporting to GGUF ({args.quantization})...")
    print(f"Output: {out_path}")

    # unsloth's save_pretrained_gguf does the merge + convert in one step.
    # It writes a directory of artifacts; we'll move the .gguf file to the
    # requested output location.
    tmp_dir = out_path.parent / (out_path.stem + "_export_tmp")
    tmp_dir.mkdir(parents=True, exist_ok=True)

    model.save_pretrained_gguf(
        str(tmp_dir),
        tokenizer,
        quantization_method=args.quantization,
    )

    # Find the produced .gguf and move it to the requested location.
    ggufs = list(tmp_dir.glob("*.gguf"))
    if not ggufs:
        raise RuntimeError(f"unsloth did not produce a GGUF file in {tmp_dir}")
    src_gguf = ggufs[0]
    if out_path.exists():
        out_path.unlink()
    src_gguf.replace(out_path)

    # Optional cleanup of the tmp dir (keep tokenizer files inside in case
    # llama.cpp needs them later).
    keep = {"tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"}
    for f in tmp_dir.iterdir():
        if f.name not in keep:
            try:
                if f.is_dir():
                    shutil.rmtree(f, ignore_errors=True)
                else:
                    f.unlink()
            except Exception:
                pass

    print(f"\nDONE. GGUF at: {out_path.resolve()}")
    print(f"  Size: {out_path.stat().st_size / 1024**3:.2f} GB")
    print(f"\nServe it with:")
    print(f"  llama-server -m {out_path} \\")
    print(f"               -ngl 99 -c 16384 --parallel 1 \\")
    print(f"               --host 127.0.0.1 --port 6969")


if __name__ == "__main__":
    main()
