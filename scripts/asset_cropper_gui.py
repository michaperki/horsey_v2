"""
Horsey Asset Cropper GUI

Features:
- Load a generated sprite sheet/image
- Draw crop boxes manually
- Auto-create a grid
- Drag individual grid divider lines for uneven AI-generated sheets
- Convert adjusted grid cells into crops
- Paste labels separated by tabs, commas, or new lines
- Optional lazy-loaded background removal via rembg
- Export cropped PNGs + manifest.json

Install:
  pip install pillow

Optional background removal:
  pip install rembg onnxruntime

Linux/WSL Tkinter:
  sudo apt install python3-tk

Run:
  python asset_cropper_gui.py
"""

from __future__ import annotations

import json
import re
import tkinter as tk
from dataclasses import asdict, dataclass
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Optional

from PIL import Image, ImageTk

rembg_remove = None
rembg_import_error = None


def get_rembg_remove():
    """Lazy-load rembg only when background removal is requested."""
    global rembg_remove, rembg_import_error
    if rembg_remove is not None:
        return rembg_remove
    if rembg_import_error is not None:
        raise rembg_import_error
    try:
        from rembg import remove
        rembg_remove = remove
        return rembg_remove
    except Exception as exc:
        rembg_import_error = exc
        raise


@dataclass
class CropBox:
    label: str
    x1: int
    y1: int
    x2: int
    y2: int

    def normalized(self) -> "CropBox":
        return CropBox(
            self.label,
            min(self.x1, self.x2),
            min(self.y1, self.y2),
            max(self.x1, self.x2),
            max(self.y1, self.y2),
        )


def safe_name(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"[^a-z0-9_-]+", "_", name)
    return name.strip("_") or "asset"


class AssetCropperApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Horsey Asset Cropper")
        self.root.geometry("1200x800")

        self.image_path: Optional[Path] = None
        self.image: Optional[Image.Image] = None
        self.tk_image: Optional[ImageTk.PhotoImage] = None
        self.scale = 1.0

        self.boxes: list[CropBox] = []
        self.rect_ids: list[int] = []
        self.text_ids: list[int] = []
        self.grid_line_ids: list[int] = []

        self.active_start: Optional[tuple[int, int]] = None
        self.preview_rect: Optional[int] = None

        self.grid_mode = False
        self.grid_cols = 0
        self.grid_rows = 0
        self.x_lines: list[int] = []
        self.y_lines: list[int] = []
        self.dragging_line: Optional[tuple[str, int]] = None

        self.remove_bg_var = tk.BooleanVar(value=False)
        self.trim_var = tk.BooleanVar(value=True)
        self.prefix_var = tk.StringVar(value="horsey")

        self._build_ui()

    def _build_ui(self):
        toolbar = ttk.Frame(self.root, padding=6)
        toolbar.pack(fill=tk.X)

        ttk.Button(toolbar, text="Load image", command=self.load_image).pack(side=tk.LEFT, padx=3)
        ttk.Button(toolbar, text="Auto grid", command=self.auto_grid).pack(side=tk.LEFT, padx=3)
        ttk.Button(toolbar, text="Grid to crops", command=self.commit_grid_to_crops).pack(side=tk.LEFT, padx=3)
        ttk.Button(toolbar, text="Clear grid", command=self.clear_grid).pack(side=tk.LEFT, padx=3)
        ttk.Button(toolbar, text="Rename selected", command=self.rename_selected).pack(side=tk.LEFT, padx=3)
        ttk.Button(toolbar, text="Paste labels", command=self.paste_labels).pack(side=tk.LEFT, padx=3)
        ttk.Button(toolbar, text="Delete selected", command=self.delete_selected).pack(side=tk.LEFT, padx=3)
        ttk.Button(toolbar, text="Export", command=self.export_assets).pack(side=tk.LEFT, padx=3)

        ttk.Separator(toolbar, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=8)
        ttk.Label(toolbar, text="Prefix:").pack(side=tk.LEFT)
        ttk.Entry(toolbar, textvariable=self.prefix_var, width=16).pack(side=tk.LEFT, padx=3)
        ttk.Checkbutton(toolbar, text="Trim transparent edges", variable=self.trim_var).pack(side=tk.LEFT, padx=8)
        ttk.Checkbutton(toolbar, text="Remove background", variable=self.remove_bg_var).pack(side=tk.LEFT, padx=8)

        main = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        main.pack(fill=tk.BOTH, expand=True)

        canvas_frame = ttk.Frame(main)
        side_frame = ttk.Frame(main, width=300, padding=8)
        main.add(canvas_frame, weight=4)
        main.add(side_frame, weight=1)

        self.canvas = tk.Canvas(canvas_frame, bg="#222", cursor="crosshair")
        self.canvas.pack(fill=tk.BOTH, expand=True)
        self.canvas.bind("<ButtonPress-1>", self.on_mouse_down)
        self.canvas.bind("<B1-Motion>", self.on_mouse_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_mouse_up)

        ttk.Label(side_frame, text="Crops", font=("Segoe UI", 12, "bold")).pack(anchor="w")
        self.listbox = tk.Listbox(side_frame, height=25)
        self.listbox.pack(fill=tk.BOTH, expand=True, pady=6)
        self.listbox.bind("<<ListboxSelect>>", lambda _event: self.redraw())

        help_text = (
            "Manual crop: drag on image.\n\n"
            "Uneven sheet workflow:\n"
            "1. Click Auto grid.\n"
            "2. Drag red/blue divider lines.\n"
            "3. Click Grid to crops.\n"
            "4. Rename assets or Paste labels.\n\n"
            "Red = vertical dividers.\n"
            "Blue = horizontal dividers."
        )
        ttk.Label(side_frame, text=help_text, justify=tk.LEFT).pack(anchor="w", pady=8)

    def load_image(self):
        path = filedialog.askopenfilename(
            title="Select sprite sheet",
            filetypes=[("Images", "*.png *.jpg *.jpeg *.webp"), ("All files", "*.*")],
        )
        if not path:
            return

        self.image_path = Path(path)
        self.image = Image.open(path).convert("RGBA")
        self.boxes.clear()
        self.clear_grid(redraw=False)
        self.refresh_image()
        self.refresh_list()

    def refresh_image(self):
        if self.image is None:
            return

        canvas_w = max(self.canvas.winfo_width(), 800)
        canvas_h = max(self.canvas.winfo_height(), 600)
        img_w, img_h = self.image.size
        self.scale = min(canvas_w / img_w, canvas_h / img_h, 1.0)

        display = self.image.resize((int(img_w * self.scale), int(img_h * self.scale)))
        self.tk_image = ImageTk.PhotoImage(display)
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self.tk_image)
        self.redraw()

    def image_coords(self, event) -> tuple[int, int]:
        return int(event.x / self.scale), int(event.y / self.scale)

    def canvas_coords(self, x: int, y: int) -> tuple[int, int]:
        return int(x * self.scale), int(y * self.scale)

    def find_near_grid_line(self, x: int, y: int) -> Optional[tuple[str, int]]:
        if not self.grid_mode:
            return None
        threshold = max(8, int(8 / self.scale))

        for idx in range(1, len(self.x_lines) - 1):
            if abs(x - self.x_lines[idx]) <= threshold:
                return ("x", idx)
        for idx in range(1, len(self.y_lines) - 1):
            if abs(y - self.y_lines[idx]) <= threshold:
                return ("y", idx)
        return None

    def on_mouse_down(self, event):
        if self.image is None:
            return

        x, y = self.image_coords(event)
        near = self.find_near_grid_line(x, y)
        if near:
            self.dragging_line = near
            return

        self.active_start = (x, y)
        if self.preview_rect:
            self.canvas.delete(self.preview_rect)
            self.preview_rect = None

    def on_mouse_drag(self, event):
        if self.image is None:
            return

        x, y = self.image_coords(event)

        if self.dragging_line:
            axis, idx = self.dragging_line
            if axis == "x":
                left = self.x_lines[idx - 1] + 2
                right = self.x_lines[idx + 1] - 2
                self.x_lines[idx] = max(left, min(right, x))
            else:
                top = self.y_lines[idx - 1] + 2
                bottom = self.y_lines[idx + 1] - 2
                self.y_lines[idx] = max(top, min(bottom, y))
            self.redraw()
            return

        if self.active_start is None:
            return

        x1, y1 = self.active_start
        cx1, cy1 = self.canvas_coords(x1, y1)
        cx2, cy2 = self.canvas_coords(x, y)
        if self.preview_rect:
            self.canvas.coords(self.preview_rect, cx1, cy1, cx2, cy2)
        else:
            self.preview_rect = self.canvas.create_rectangle(cx1, cy1, cx2, cy2, outline="yellow", width=2)

    def on_mouse_up(self, event):
        if self.image is None:
            return

        if self.dragging_line:
            self.dragging_line = None
            return

        if self.active_start is None:
            return

        x1, y1 = self.active_start
        x2, y2 = self.image_coords(event)
        self.active_start = None

        box = CropBox(f"asset_{len(self.boxes) + 1:03d}", x1, y1, x2, y2).normalized()
        if box.x2 - box.x1 < 5 or box.y2 - box.y1 < 5:
            return
        self.boxes.append(box)
        self.refresh_list()
        self.redraw()

    def auto_grid(self):
        if self.image is None:
            messagebox.showinfo("No image", "Load an image first.")
            return

        rows = simpledialog.askinteger("Rows", "Number of rows:", minvalue=1)
        cols = simpledialog.askinteger("Columns", "Number of columns:", minvalue=1)
        if not rows or not cols:
            return

        margin = simpledialog.askinteger("Outer margin", "Outer margin in px:", initialvalue=0, minvalue=0) or 0
        gap = simpledialog.askinteger("Approx gap", "Approx gap between cells in px:", initialvalue=0, minvalue=0) or 0

        w, h = self.image.size
        self.grid_rows = rows
        self.grid_cols = cols
        self.grid_mode = True

        usable_w = w - 2 * margin - gap * (cols - 1)
        usable_h = h - 2 * margin - gap * (rows - 1)
        cell_w = usable_w / cols
        cell_h = usable_h / rows

        self.x_lines = [margin]
        for c in range(1, cols):
            self.x_lines.append(int(margin + c * cell_w + c * gap))
        self.x_lines.append(w - margin)

        self.y_lines = [margin]
        for r in range(1, rows):
            self.y_lines.append(int(margin + r * cell_h + r * gap))
        self.y_lines.append(h - margin)

        self.redraw()

    def clear_grid(self, redraw: bool = True):
        self.grid_mode = False
        self.grid_cols = 0
        self.grid_rows = 0
        self.x_lines.clear()
        self.y_lines.clear()
        self.dragging_line = None
        if redraw:
            self.redraw()

    def commit_grid_to_crops(self):
        if not self.grid_mode or not self.x_lines or not self.y_lines:
            messagebox.showinfo("No grid", "Create an Auto grid first.")
            return

        self.boxes.clear()
        for r in range(len(self.y_lines) - 1):
            for c in range(len(self.x_lines) - 1):
                self.boxes.append(
                    CropBox(
                        label=f"asset_{r + 1}_{c + 1}",
                        x1=self.x_lines[c],
                        y1=self.y_lines[r],
                        x2=self.x_lines[c + 1],
                        y2=self.y_lines[r + 1],
                    )
                )
        self.refresh_list()
        self.redraw()

    def selected_index(self) -> Optional[int]:
        selection = self.listbox.curselection()
        return selection[0] if selection else None

    def rename_selected(self):
        idx = self.selected_index()
        if idx is None:
            return
        current = self.boxes[idx].label
        new_label = simpledialog.askstring("Rename", "Asset label:", initialvalue=current)
        if new_label:
            self.boxes[idx].label = safe_name(new_label)
            self.refresh_list()
            self.redraw()

    def paste_labels(self):
        if not self.boxes:
            messagebox.showinfo("No crops", "Create crops first, then paste labels.")
            return

        dialog = tk.Toplevel(self.root)
        dialog.title("Paste labels")
        dialog.geometry("520x360")
        dialog.transient(self.root)
        dialog.grab_set()

        ttk.Label(
            dialog,
            text="Paste labels separated by tabs, commas, or new lines. Labels apply left-to-right, top-to-bottom.",
            wraplength=480,
        ).pack(anchor="w", padx=10, pady=8)

        text = tk.Text(dialog, height=14, width=64)
        text.pack(fill=tk.BOTH, expand=True, padx=10, pady=6)
        text.focus_set()

        def apply_labels():
            raw = text.get("1.0", tk.END).strip()
            labels = [part.strip() for part in re.split(r"[\t,\n\r]+", raw) if part.strip()]
            if not labels:
                dialog.destroy()
                return

            for box, label in zip(self.boxes, labels):
                box.label = safe_name(label)

            applied = min(len(labels), len(self.boxes))
            self.refresh_list()
            self.redraw()
            dialog.destroy()

            if len(labels) != len(self.boxes):
                messagebox.showinfo(
                    "Labels applied",
                    f"Applied {applied} labels. You have {len(self.boxes)} crops and pasted {len(labels)} labels.",
                )

        buttons = ttk.Frame(dialog)
        buttons.pack(fill=tk.X, padx=10, pady=8)
        ttk.Button(buttons, text="Apply", command=apply_labels).pack(side=tk.RIGHT, padx=4)
        ttk.Button(buttons, text="Cancel", command=dialog.destroy).pack(side=tk.RIGHT, padx=4)

    def delete_selected(self):
        idx = self.selected_index()
        if idx is None:
            return
        del self.boxes[idx]
        self.refresh_list()
        self.redraw()

    def refresh_list(self):
        self.listbox.delete(0, tk.END)
        for i, box in enumerate(self.boxes):
            self.listbox.insert(tk.END, f"{i + 1:02d}. {box.label}  ({box.x1},{box.y1})-({box.x2},{box.y2})")

    def redraw(self):
        for rid in self.rect_ids + self.text_ids + self.grid_line_ids:
            self.canvas.delete(rid)
        self.rect_ids.clear()
        self.text_ids.clear()
        self.grid_line_ids.clear()

        if self.grid_mode and self.image is not None:
            img_w, img_h = self.image.size
            for i, x in enumerate(self.x_lines):
                cx, _ = self.canvas_coords(x, 0)
                _, cy2 = self.canvas_coords(0, img_h)
                color = "red" if 0 < i < len(self.x_lines) - 1 else "#aa5555"
                width = 3 if 0 < i < len(self.x_lines) - 1 else 1
                self.grid_line_ids.append(self.canvas.create_line(cx, 0, cx, cy2, fill=color, width=width))

            for i, y in enumerate(self.y_lines):
                _, cy = self.canvas_coords(0, y)
                cx2, _ = self.canvas_coords(img_w, 0)
                color = "deepskyblue" if 0 < i < len(self.y_lines) - 1 else "#5588aa"
                width = 3 if 0 < i < len(self.y_lines) - 1 else 1
                self.grid_line_ids.append(self.canvas.create_line(0, cy, cx2, cy, fill=color, width=width))

            for r in range(len(self.y_lines) - 1):
                for c in range(len(self.x_lines) - 1):
                    cx, cy = self.canvas_coords(self.x_lines[c] + 4, self.y_lines[r] + 4)
                    self.grid_line_ids.append(
                        self.canvas.create_text(cx, cy, anchor="nw", fill="white", text=f"{r + 1},{c + 1}")
                    )

        selected = self.selected_index()
        for i, box in enumerate(self.boxes):
            cx1, cy1 = self.canvas_coords(box.x1, box.y1)
            cx2, cy2 = self.canvas_coords(box.x2, box.y2)
            color = "cyan" if i == selected else "lime"
            width = 3 if i == selected else 2
            self.rect_ids.append(self.canvas.create_rectangle(cx1, cy1, cx2, cy2, outline=color, width=width))
            self.text_ids.append(self.canvas.create_text(cx1 + 4, cy1 + 4, anchor="nw", fill=color, text=box.label))

    def process_crop(self, crop: Image.Image) -> Image.Image:
        crop = crop.convert("RGBA")

        if self.remove_bg_var.get():
            try:
                remove_bg = get_rembg_remove()
            except Exception as exc:
                raise RuntimeError(
                    "Background removal requires: pip install rembg onnxruntime\n"
                    f"Import error: {exc}"
                ) from exc
            crop = remove_bg(crop)
            if not isinstance(crop, Image.Image):
                crop = Image.open(crop).convert("RGBA")

        if self.trim_var.get():
            bbox = crop.getbbox()
            if bbox:
                crop = crop.crop(bbox)

        return crop

    def export_assets(self):
        if self.image is None or not self.boxes:
            messagebox.showinfo("Nothing to export", "Load an image and create at least one crop.")
            return

        out_dir = filedialog.askdirectory(title="Choose export folder")
        if not out_dir:
            return
        out_path = Path(out_dir)
        out_path.mkdir(parents=True, exist_ok=True)

        manifest = []
        prefix = safe_name(self.prefix_var.get())

        try:
            for i, raw_box in enumerate(self.boxes, start=1):
                box = raw_box.normalized()
                crop = self.image.crop((box.x1, box.y1, box.x2, box.y2))
                crop = self.process_crop(crop)

                filename = f"{prefix}_{i:03d}_{safe_name(box.label)}.png"
                crop.save(out_path / filename)

                manifest.append(
                    {
                        "id": safe_name(box.label),
                        "filename": filename,
                        "source": str(self.image_path) if self.image_path else None,
                        "box": asdict(box),
                        "width": crop.width,
                        "height": crop.height,
                        "background_removed": bool(self.remove_bg_var.get()),
                    }
                )

            with open(out_path / "manifest.json", "w", encoding="utf-8") as file:
                json.dump(manifest, file, indent=2)

            messagebox.showinfo("Export complete", f"Exported {len(manifest)} assets to:\n{out_path}")
        except Exception as exc:
            messagebox.showerror("Export failed", str(exc))


if __name__ == "__main__":
    root = tk.Tk()
    app = AssetCropperApp(root)
    root.mainloop()
