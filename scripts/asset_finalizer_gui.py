#!/usr/bin/env python3
"""
Asset Finalizer GUI

A small local workstation for reviewing batches of generated/cropped game assets.

Features:
- Open an assets root containing batch_1, batch_2, etc.
- Review one image at a time.
- Draw/adjust a crop rectangle.
- Auto-trim transparent/near-white border.
- Optional background removal via rembg if installed.
- Preview on checkerboard.
- Save finalized transparent PNGs into assets/finalized/<batch_name>/...
- Tracks progress in manifest.json.

Install:
    pip install pillow
Optional background removal:
    pip install rembg onnxruntime

Run:
    python asset_finalizer_gui.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import traceback
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageTk, ImageChops


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


@dataclass
class AssetRecord:
    path: str
    batch: str
    status: str = "pending"  # pending, done, skipped, error
    output: str = ""
    crop: Optional[Tuple[int, int, int, int]] = None  # x1, y1, x2, y2
    background_removed: bool = False
    error: str = ""


class AssetFinalizerApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Asset Finalizer")
        self.root.geometry("1200x800")

        self.assets_root: Optional[Path] = None
        self.output_root: Optional[Path] = None
        self.manifest_path: Optional[Path] = None

        self.records: List[AssetRecord] = []
        self.index = 0

        self.original_image: Optional[Image.Image] = None
        self.working_image: Optional[Image.Image] = None
        self.display_image: Optional[ImageTk.PhotoImage] = None

        self.scale = 1.0
        self.offset_x = 0
        self.offset_y = 0

        self.crop_rect_id: Optional[int] = None
        self.crop_start: Optional[Tuple[int, int]] = None
        self.crop_box_img: Optional[Tuple[int, int, int, int]] = None

        self.rembg_available = False
        self._rembg_remove = None
        self.check_rembg()

        self.build_ui()
        self.bind_keys()

    # ---------- Setup ----------

    def check_rembg(self):
        try:
            from rembg import remove  # type: ignore
            self._rembg_remove = remove
            self.rembg_available = True
        except Exception:
            self.rembg_available = False

    def build_ui(self):
        top = ttk.Frame(self.root, padding=8)
        top.pack(side=tk.TOP, fill=tk.X)

        ttk.Button(top, text="Open assets folder", command=self.open_assets_folder).pack(side=tk.LEFT)
        ttk.Button(top, text="Prev", command=self.prev_image).pack(side=tk.LEFT, padx=(12, 0))
        ttk.Button(top, text="Next", command=self.next_image).pack(side=tk.LEFT)
        ttk.Button(top, text="Skip", command=self.skip_image).pack(side=tk.LEFT, padx=(12, 0))
        ttk.Button(top, text="Save + Next", command=self.save_and_next).pack(side=tk.LEFT)

        ttk.Separator(top, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=12)

        ttk.Button(top, text="Auto trim", command=self.auto_trim).pack(side=tk.LEFT)
        ttk.Button(top, text="Remove BG", command=self.remove_background).pack(side=tk.LEFT)
        ttk.Button(top, text="Reset", command=self.reset_image).pack(side=tk.LEFT)
        ttk.Button(top, text="Clear crop", command=self.clear_crop).pack(side=tk.LEFT)

        self.status_var = tk.StringVar(value="Open an assets folder to begin.")
        ttk.Label(top, textvariable=self.status_var).pack(side=tk.LEFT, padx=16)

        main = ttk.Frame(self.root)
        main.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        left = ttk.Frame(main, width=260)
        left.pack(side=tk.LEFT, fill=tk.Y)

        self.listbox = tk.Listbox(left, width=42)
        self.listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar = ttk.Scrollbar(left, orient=tk.VERTICAL, command=self.listbox.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.listbox.config(yscrollcommand=scrollbar.set)
        self.listbox.bind("<<ListboxSelect>>", self.on_list_select)

        canvas_frame = ttk.Frame(main)
        canvas_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.canvas = tk.Canvas(canvas_frame, bg="#202020", highlightthickness=0)
        self.canvas.pack(fill=tk.BOTH, expand=True)

        bottom = ttk.Frame(self.root, padding=8)
        bottom.pack(side=tk.BOTTOM, fill=tk.X)

        rembg_status = "rembg available" if self.rembg_available else "rembg not installed"
        self.help_var = tk.StringVar(
            value=f"Keys: Enter save+next | Space next | Backspace prev | S skip | A auto trim | R remove bg | Esc clear crop | Mouse drag crop | {rembg_status}"
        )
        ttk.Label(bottom, textvariable=self.help_var).pack(side=tk.LEFT)

        self.canvas.bind("<Configure>", lambda e: self.render())
        self.canvas.bind("<ButtonPress-1>", self.on_mouse_down)
        self.canvas.bind("<B1-Motion>", self.on_mouse_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_mouse_up)

    def bind_keys(self):
        self.root.bind("<Return>", lambda e: self.save_and_next())
        self.root.bind("<space>", lambda e: self.next_image())
        self.root.bind("<BackSpace>", lambda e: self.prev_image())
        self.root.bind("s", lambda e: self.skip_image())
        self.root.bind("S", lambda e: self.skip_image())
        self.root.bind("a", lambda e: self.auto_trim())
        self.root.bind("A", lambda e: self.auto_trim())
        self.root.bind("r", lambda e: self.remove_background())
        self.root.bind("R", lambda e: self.remove_background())
        self.root.bind("<Escape>", lambda e: self.clear_crop())

    # ---------- Loading ----------

    def open_assets_folder(self):
        folder = filedialog.askdirectory(title="Select assets root folder")
        if not folder:
            return

        self.assets_root = Path(folder)
        self.output_root = self.assets_root / "finalized"
        self.output_root.mkdir(exist_ok=True)
        self.manifest_path = self.assets_root / "manifest.json"

        self.records = self.scan_assets(self.assets_root)
        self.load_manifest()
        self.index = self.first_pending_index()

        self.refresh_listbox()
        self.load_current_image()

    def scan_assets(self, root: Path) -> List[AssetRecord]:
        records: List[AssetRecord] = []

        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in IMAGE_EXTS:
                continue
            if "finalized" in path.parts:
                continue

            try:
                batch = path.parent.relative_to(root).as_posix()
            except ValueError:
                batch = path.parent.name

            records.append(AssetRecord(path=str(path), batch=batch))

        return records

    def load_manifest(self):
        if not self.manifest_path or not self.manifest_path.exists():
            return

        try:
            data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
            by_path: Dict[str, Dict[str, Any]] = {item["path"]: item for item in data.get("records", [])}
            for rec in self.records:
                existing = by_path.get(rec.path)
                if existing:
                    rec.status = existing.get("status", rec.status)
                    rec.output = existing.get("output", rec.output)
                    rec.crop = tuple(existing["crop"]) if existing.get("crop") else None
                    rec.background_removed = bool(existing.get("background_removed", False))
                    rec.error = existing.get("error", "")
        except Exception as exc:
            messagebox.showwarning("Manifest warning", f"Could not read manifest.json:\n{exc}")

    def save_manifest(self):
        if not self.manifest_path:
            return
        data = {
            "assets_root": str(self.assets_root) if self.assets_root else "",
            "output_root": str(self.output_root) if self.output_root else "",
            "records": [asdict(r) for r in self.records],
        }
        self.manifest_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def first_pending_index(self) -> int:
        for i, rec in enumerate(self.records):
            if rec.status == "pending":
                return i
        return 0

    # ---------- Image operations ----------

    def load_current_image(self):
        if not self.records:
            self.status_var.set("No images found.")
            return

        rec = self.records[self.index]
        try:
            self.original_image = Image.open(rec.path).convert("RGBA")
            self.working_image = self.original_image.copy()
            self.crop_box_img = rec.crop
            self.render()
            self.update_status()
            self.select_listbox_index()
        except Exception as exc:
            rec.status = "error"
            rec.error = str(exc)
            self.save_manifest()
            self.refresh_listbox()
            messagebox.showerror("Load error", f"Could not load image:\n{rec.path}\n\n{exc}")

    def reset_image(self):
        if self.original_image is not None:
            self.working_image = self.original_image.copy()
            self.crop_box_img = None
            self.render()

    def auto_trim(self):
        if self.working_image is None:
            return

        img = self.working_image.convert("RGBA")

        # Prefer alpha trim if transparency exists.
        alpha = img.getchannel("A")
        alpha_bbox = alpha.getbbox()
        if alpha_bbox:
            self.crop_box_img = alpha_bbox
            self.render()
            return

        # Fallback: trim near-white/near-solid borders.
        bg = Image.new("RGBA", img.size, img.getpixel((0, 0)))
        diff = ImageChops.difference(img, bg)
        diff = ImageChops.add(diff, diff, 2.0, -20)
        bbox = diff.getbbox()

        if bbox:
            self.crop_box_img = bbox
            self.render()
        else:
            messagebox.showinfo("Auto trim", "No trim bounds detected.")

    def remove_background(self):
        if self.working_image is None:
            return
        if not self.rembg_available or self._rembg_remove is None:
            messagebox.showwarning(
                "rembg not installed",
                "Background removal needs:\n\npip install rembg onnxruntime"
            )
            return

        try:
            self.status_var.set("Removing background...")
            self.root.update_idletasks()

            result = self._rembg_remove(self.working_image)
            if isinstance(result, bytes):
                from io import BytesIO
                result_img = Image.open(BytesIO(result)).convert("RGBA")
            else:
                result_img = result.convert("RGBA")

            self.working_image = result_img
            self.records[self.index].background_removed = True

            # After BG removal, auto-set crop to alpha bounds.
            alpha_bbox = self.working_image.getchannel("A").getbbox()
            self.crop_box_img = alpha_bbox
            self.render()
            self.update_status()
        except Exception as exc:
            traceback.print_exc()
            messagebox.showerror("Background removal failed", str(exc))

    def final_image(self) -> Optional[Image.Image]:
        if self.working_image is None:
            return None

        img = self.working_image.copy()
        if self.crop_box_img:
            x1, y1, x2, y2 = self.crop_box_img
            x1 = max(0, min(x1, img.width - 1))
            y1 = max(0, min(y1, img.height - 1))
            x2 = max(x1 + 1, min(x2, img.width))
            y2 = max(y1 + 1, min(y2, img.height))
            img = img.crop((x1, y1, x2, y2))
        return img

    def save_current(self) -> bool:
        if not self.records or self.working_image is None or not self.output_root:
            return False

        rec = self.records[self.index]
        src = Path(rec.path)

        rel_parent = Path(rec.batch)
        out_dir = self.output_root / rel_parent
        out_dir.mkdir(parents=True, exist_ok=True)

        out_name = src.stem + ".png"
        out_path = out_dir / out_name

        img = self.final_image()
        if img is None:
            return False

        try:
            img.save(out_path)
            rec.status = "done"
            rec.output = str(out_path)
            rec.crop = self.crop_box_img
            self.save_manifest()
            self.refresh_listbox()
            self.update_status()
            return True
        except Exception as exc:
            rec.status = "error"
            rec.error = str(exc)
            self.save_manifest()
            self.refresh_listbox()
            messagebox.showerror("Save failed", str(exc))
            return False

    # ---------- Navigation ----------

    def save_and_next(self):
        if self.save_current():
            self.next_image()

    def next_image(self):
        if not self.records:
            return
        self.index = min(len(self.records) - 1, self.index + 1)
        self.load_current_image()

    def prev_image(self):
        if not self.records:
            return
        self.index = max(0, self.index - 1)
        self.load_current_image()

    def skip_image(self):
        if not self.records:
            return
        rec = self.records[self.index]
        rec.status = "skipped"
        self.save_manifest()
        self.refresh_listbox()
        self.next_image()

    # ---------- Listbox ----------

    def refresh_listbox(self):
        self.listbox.delete(0, tk.END)
        for i, rec in enumerate(self.records):
            mark = {
                "pending": "○",
                "done": "✓",
                "skipped": "–",
                "error": "!",
            }.get(rec.status, "?")
            name = Path(rec.path).name
            self.listbox.insert(tk.END, f"{mark} {i+1:04d}  {rec.batch}/{name}")
        self.select_listbox_index()

    def select_listbox_index(self):
        if not self.records:
            return
        self.listbox.selection_clear(0, tk.END)
        self.listbox.selection_set(self.index)
        self.listbox.see(self.index)

    def on_list_select(self, event=None):
        sel = self.listbox.curselection()
        if not sel:
            return
        self.index = int(sel[0])
        self.load_current_image()

    # ---------- Rendering ----------

    def render(self):
        self.canvas.delete("all")
        if self.working_image is None:
            return

        canvas_w = max(1, self.canvas.winfo_width())
        canvas_h = max(1, self.canvas.winfo_height())

        img = self.working_image
        margin = 40
        scale = min((canvas_w - margin) / img.width, (canvas_h - margin) / img.height)
        scale = min(scale, 4.0)
        scale = max(scale, 0.05)
        self.scale = scale

        disp_w = max(1, int(img.width * scale))
        disp_h = max(1, int(img.height * scale))
        self.offset_x = (canvas_w - disp_w) // 2
        self.offset_y = (canvas_h - disp_h) // 2

        preview = self.make_checkerboard(disp_w, disp_h)
        resized = img.resize((disp_w, disp_h), Image.Resampling.LANCZOS)
        preview.alpha_composite(resized)

        self.display_image = ImageTk.PhotoImage(preview)
        self.canvas.create_image(self.offset_x, self.offset_y, image=self.display_image, anchor=tk.NW)

        # Image border
        self.canvas.create_rectangle(
            self.offset_x, self.offset_y,
            self.offset_x + disp_w, self.offset_y + disp_h,
            outline="#777777"
        )

        if self.crop_box_img:
            x1, y1, x2, y2 = self.crop_box_img
            cx1, cy1 = self.img_to_canvas(x1, y1)
            cx2, cy2 = self.img_to_canvas(x2, y2)
            self.canvas.create_rectangle(cx1, cy1, cx2, cy2, outline="#00ff99", width=2)

    def make_checkerboard(self, w: int, h: int, tile: int = 16) -> Image.Image:
        img = Image.new("RGBA", (w, h), (230, 230, 230, 255))
        px = img.load()
        for y in range(h):
            for x in range(w):
                if ((x // tile) + (y // tile)) % 2 == 0:
                    px[x, y] = (190, 190, 190, 255)
        return img

    def canvas_to_img(self, x: int, y: int) -> Tuple[int, int]:
        if self.working_image is None:
            return 0, 0
        ix = int((x - self.offset_x) / self.scale)
        iy = int((y - self.offset_y) / self.scale)
        ix = max(0, min(ix, self.working_image.width))
        iy = max(0, min(iy, self.working_image.height))
        return ix, iy

    def img_to_canvas(self, x: int, y: int) -> Tuple[int, int]:
        return int(self.offset_x + x * self.scale), int(self.offset_y + y * self.scale)

    # ---------- Mouse crop ----------

    def on_mouse_down(self, event):
        if self.working_image is None:
            return
        self.crop_start = self.canvas_to_img(event.x, event.y)
        self.crop_box_img = None
        self.render()

    def on_mouse_drag(self, event):
        if self.working_image is None or self.crop_start is None:
            return
        x1, y1 = self.crop_start
        x2, y2 = self.canvas_to_img(event.x, event.y)
        self.crop_box_img = (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))
        self.render()

    def on_mouse_up(self, event):
        if self.working_image is None or self.crop_start is None:
            return
        x1, y1 = self.crop_start
        x2, y2 = self.canvas_to_img(event.x, event.y)
        if abs(x2 - x1) < 3 or abs(y2 - y1) < 3:
            self.crop_box_img = None
        else:
            self.crop_box_img = (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))
        self.crop_start = None
        self.render()

    def clear_crop(self):
        self.crop_box_img = None
        self.render()

    # ---------- Status ----------

    def update_status(self):
        if not self.records:
            self.status_var.set("No images loaded.")
            return

        done = sum(1 for r in self.records if r.status == "done")
        skipped = sum(1 for r in self.records if r.status == "skipped")
        errors = sum(1 for r in self.records if r.status == "error")
        rec = self.records[self.index]
        img_info = ""
        if self.working_image:
            img_info = f" | {self.working_image.width}x{self.working_image.height}"

        self.status_var.set(
            f"{self.index + 1}/{len(self.records)} | done {done} | skipped {skipped} | errors {errors} | {Path(rec.path).name}{img_info}"
        )


def main():
    root = tk.Tk()
    app = AssetFinalizerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
