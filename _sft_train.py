"""
SFT training for Qwen3-4B-Instruct-2507 on v3.5 structured-COT traces.

Designed to run on a rental GPU (RTX 4090 / A4000 / A100, 16+ GB VRAM).
QLoRA via unsloth, 4K context, ~98 training examples, 2 epochs target.

One-command launch (after pip install -r requirements-train.txt):

    python _sft_train.py \\
        --dataset data/sft_dataset/train.jsonl \\
        --output_dir adapters/qwen3_4b_v35_run1

The trained adapter directory contains:
    - adapter_model.safetensors (LoRA weights)
    - adapter_config.json
    - tokenizer.json (copy of base tokenizer)
    - training_log.json (loss curve + step metadata)
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="data/sft_dataset/train.jsonl",
                    help="Path to JSONL with {messages, meta} per line")
    ap.add_argument("--base_model", default="unsloth/Qwen3-4B-Instruct-2507",
                    help="HuggingFace model id (unsloth-optimized variant recommended)")
    ap.add_argument("--output_dir", default="adapters/qwen3_4b_v35_run1",
                    help="Where to save the trained LoRA adapter")
    ap.add_argument("--max_seq_length", type=int, default=4096,
                    help="Training context length. Match the prep script.")
    ap.add_argument("--load_in_4bit", action="store_true", default=True,
                    help="Use QLoRA 4-bit base. Disable only if you have >24GB VRAM and want bf16 base.")
    ap.add_argument("--lora_r", type=int, default=16, help="LoRA rank")
    ap.add_argument("--lora_alpha", type=int, default=32, help="LoRA alpha (typically 2*r)")
    ap.add_argument("--lora_dropout", type=float, default=0.05)
    ap.add_argument("--learning_rate", type=float, default=2e-4)
    ap.add_argument("--num_epochs", type=int, default=2)
    ap.add_argument("--per_device_batch_size", type=int, default=1)
    ap.add_argument("--grad_accum_steps", type=int, default=8,
                    help="Effective batch = per_device_batch_size * grad_accum_steps")
    ap.add_argument("--warmup_ratio", type=float, default=0.10)
    ap.add_argument("--weight_decay", type=float, default=0.01)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--save_steps", type=int, default=50)
    ap.add_argument("--eval_split_ratio", type=float, default=0.10,
                    help="Fraction of dataset held out for in-training eval (early-stopping).")
    return ap.parse_args()


def load_dataset(path: str, eval_split_ratio: float, seed: int):
    """Load the JSONL we produced via _sft_prepare_data.py and split into
    train/eval. Eval split is BY-EXAMPLE within graphs (not by graph) —
    we have a separate held-out eval set of brand-new graphs that's not
    in this jsonl at all, for true generalization eval.
    """
    import random
    rng = random.Random(seed)

    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))

    rng.shuffle(records)
    n_eval = max(1, int(len(records) * eval_split_ratio))
    eval_records = records[:n_eval]
    train_records = records[n_eval:]
    print(f"Dataset: {len(records)} total -> {len(train_records)} train + {len(eval_records)} eval")
    return train_records, eval_records


def to_hf_dataset(records: list[dict], tokenizer):
    """Convert our records (containing 'messages' and 'meta') into a HF
    Dataset that unsloth/TRL can consume. We pre-apply the chat template
    here and emit a plain `text` column — modern TRL's SFTTrainer wants
    either a `formatting_func` returning a list of strings (batched API)
    or a pre-formatted `dataset_text_field`. The latter is simpler and
    more robust across TRL versions.
    """
    from datasets import Dataset
    rows = []
    for r in records:
        text = tokenizer.apply_chat_template(
            r["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        rows.append({"text": text})
    return Dataset.from_list(rows)


def main():
    args = parse_args()
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Save the resolved args next to the adapter so the training is fully
    # reproducible by reading just the adapter dir.
    (out_dir / "training_args.json").write_text(
        json.dumps(vars(args), ensure_ascii=False, indent=2), encoding="utf-8",
    )

    # Lazy imports so the script's --help doesn't require the full stack.
    print("Importing unsloth, transformers, trl, peft...")
    from unsloth import FastLanguageModel, is_bfloat16_supported
    from trl import SFTTrainer, SFTConfig
    from transformers import TrainerCallback

    print(f"\nLoading base model: {args.base_model}")
    print(f"  4-bit: {args.load_in_4bit}   max_seq_length: {args.max_seq_length}")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=args.max_seq_length,
        load_in_4bit=args.load_in_4bit,
        dtype=None,  # auto-detect
    )

    print(f"\nAttaching LoRA: r={args.lora_r}, alpha={args.lora_alpha}, "
          f"dropout={args.lora_dropout}")
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=args.seed,
        use_rslora=False,
        loftq_config=None,
    )

    print(f"\nLoading dataset: {args.dataset}")
    train_recs, eval_recs = load_dataset(
        args.dataset, args.eval_split_ratio, args.seed,
    )
    # Merge eval back into train. In-training eval blows VRAM on V100s
    # because eval forwards don't use gradient checkpointing / padding-free
    # and the SDPA attention matrix at 4K context allocates 15+ GiB on top
    # of the 20 GiB the model already holds. Eval loss on 9 examples is
    # noisy anyway — real generalization is measured by _sft_eval.py on
    # the held-out eval graphs.
    train_recs = train_recs + eval_recs
    print(f"  (merged eval split back into train: {len(train_recs)} total examples for training)")
    train_ds = to_hf_dataset(train_recs, tokenizer)

    sft_config = SFTConfig(
        output_dir=str(out_dir),
        per_device_train_batch_size=args.per_device_batch_size,
        gradient_accumulation_steps=args.grad_accum_steps,
        warmup_ratio=args.warmup_ratio,
        num_train_epochs=args.num_epochs,
        learning_rate=args.learning_rate,
        fp16=not is_bfloat16_supported(),
        bf16=is_bfloat16_supported(),
        logging_steps=5,
        save_strategy="epoch",             # save once per epoch (small corpus: 2 saves total)
        eval_strategy="no",                # see note above; held-out eval lives in _sft_eval.py
        optim="paged_adamw_8bit",
        weight_decay=args.weight_decay,
        lr_scheduler_type="cosine",
        seed=args.seed,
        report_to="none",
        max_seq_length=args.max_seq_length,
        packing=False,                     # keep examples separate; small corpus, packing risks confusion
        dataset_text_field="text",
    )

    # Custom callback to dump the loss curve to JSON for later inspection.
    class LossLogger(TrainerCallback):
        def __init__(self):
            self.log: list[dict] = []

        def on_log(self, args, state, control, logs=None, **kwargs):
            if logs:
                entry = {"step": state.global_step, **logs}
                self.log.append(entry)

        def on_train_end(self, args, state, control, **kwargs):
            (out_dir / "training_log.json").write_text(
                json.dumps(self.log, ensure_ascii=False, indent=2), encoding="utf-8",
            )

    print(f"\nLaunching SFTTrainer...")
    print(f"  Train: {len(train_ds)} examples")
    print(f"  Effective batch: {args.per_device_batch_size * args.grad_accum_steps}")
    print(f"  Total epochs: {args.num_epochs}")

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_ds,
        args=sft_config,
        callbacks=[LossLogger()],
    )

    # Save-in-finally guard. If anything in the inner training loop raises
    # (typical culprits: OOM during a late forward, NaN loss), we still
    # persist whatever weights we have so the run isn't wasted.
    trainer_stats = None
    try:
        trainer_stats = trainer.train()
    except Exception as exc:
        print(f"\n[!] trainer.train() raised: {type(exc).__name__}: {exc}")
        print(f"[!] Attempting to save partial adapter so the run is not lost.")

    if trainer_stats is not None:
        print(f"\nTraining complete. Stats:")
        print(json.dumps({
            "train_runtime_seconds": trainer_stats.metrics.get("train_runtime"),
            "train_loss": trainer_stats.metrics.get("train_loss"),
            "epochs_completed": trainer_stats.metrics.get("epoch"),
        }, indent=2))

    print(f"\nSaving final adapter to {out_dir}")
    model.save_pretrained(str(out_dir))
    tokenizer.save_pretrained(str(out_dir))

    print(f"\nDONE. Adapter dir: {out_dir.resolve()}")
    print(f"  To use: load base model + apply this adapter via PEFT, "
          f"or merge + export GGUF via _sft_export_to_gguf.py")


if __name__ == "__main__":
    main()
