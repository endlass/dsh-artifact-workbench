#!/usr/bin/env python3
"""Dump a compact, hit-test/edit friendly inventory of a .pptx for the PPT workbench.

Usage: python3 inventory.py <deck.pptx> <out.json>

Output (compact, JSON):
{
  "slideWidthEmu": int, "slideHeightEmu": int, "slideCount": int,
  "slides": [{
     "index": 0, "slideId": 256, "notes": str, "textSha1": str,
     "shapes": [{
        "shapeId": int, "name": str, "type": "AUTO_SHAPE"|..., "isPlaceholder": bool,
        "left": int, "top": int, "width": int, "height": int,     # EMU, absolute page coords
        "rotation": float, "hasText": bool, "textPreview": str, "textSha1": str,
        "text": str, "paragraphCount": int,
        "font": { "sizePt": float|null, "bold": bool|null, "italic": bool|null, "color": "RRGGBB"|null },
        "editable": bool,
        "groupPath": [str, ...], "hasTable": bool, "hasChart": bool, "hasPicture": bool,
        "table": { "rows": int, "cols": int, "cells": [[str]] },
        "chart": { "categories": [str], "series": [{ "name": str, "values": [float] }] }
     }]
  }]
}
"""
from __future__ import annotations

import hashlib
import json
import sys

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE


def sha1_16(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", "replace")).hexdigest()[:16]


def emu(value) -> int:
    return 0 if value is None else int(value)


def color_hex(font):
    try:
        if font.color and font.color.type is not None:
            rgb = font.color.rgb
            if rgb is not None:
                return str(rgb).upper()
    except Exception:
        pass
    return None


def font_info(shape) -> dict:
    result = {"sizePt": None, "bold": None, "italic": None, "color": None}
    if not shape or not getattr(shape, "has_text_frame", False):
        return result
    try:
        for paragraph in shape.text_frame.paragraphs:
            for run in paragraph.runs:
                if run.text and run.text.strip():
                    result["sizePt"] = None if run.font.size is None else round(float(run.font.size.pt), 2)
                    result["bold"] = run.font.bold
                    result["italic"] = run.font.italic
                    result["color"] = color_hex(run.font)
                    return result
    except Exception:
        pass
    return result


def table_info(shape) -> dict | None:
    try:
        if not getattr(shape, "has_table", False):
            return None
        table = shape.table
        rows = len(table.rows)
        cols = len(table.columns)
        max_rows = min(rows, 12)
        max_cols = min(cols, 8)
        cells = []
        for row in range(max_rows):
            line = []
            for col in range(max_cols):
                try:
                    line.append(str(table.cell(row, col).text)[:1000])
                except Exception:
                    line.append("")
            cells.append(line)
        return {"rows": rows, "cols": cols, "cells": cells}
    except Exception:
        return None


def chart_info(shape) -> dict | None:
    try:
        if not getattr(shape, "has_chart", False):
            return None
        chart = shape.chart
        try:
            categories = [str(item) for item in list(chart.plots[0].categories)][:24]
        except Exception:
            categories = []
        series = []
        for entry in list(chart.series)[:6]:
            try:
                values = list(entry.values)[:24]
            except Exception:
                values = []
            series.append({
                "name": str(entry.name) if entry.name is not None else "",
                "values": [round(float(value), 6) if isinstance(value, (int, float)) else value for value in values],
            })
        return {"categories": categories, "series": series}
    except Exception:
        return None


def group_transform(group, parent_abs, parent_scale):
    """Return (offset_x, offset_y, scale_x, scale_y) mapping child coords to page EMU."""
    gx = parent_abs[0] + group.left * parent_scale[0]
    gy = parent_abs[1] + group.top * parent_scale[1]
    gw = group.width * parent_scale[0]
    gh = group.height * parent_scale[1]
    try:
        xfrm = group._element.grpSpPr.xfrm
        ch_off_x = int(xfrm.chOff.x)
        ch_off_y = int(xfrm.chOff.y)
        ch_ext_x = int(xfrm.chExt.cx) or 1
        ch_ext_y = int(xfrm.chExt.cy) or 1
    except Exception:
        ch_off_x = ch_off_y = 0
        ch_ext_x = emu(group.width) or 1
        ch_ext_y = emu(group.height) or 1
    sx = gw / ch_ext_x if ch_ext_x else 1.0
    sy = gh / ch_ext_y if ch_ext_y else 1.0
    return (gx - ch_off_x * sx, gy - ch_off_y * sy, sx, sy)


def flatten_shape(shape, offset, scale, group_path, out):
    left = offset[0] + emu(shape.left) * scale[0]
    top = offset[1] + emu(shape.top) * scale[1]
    width = emu(shape.width) * scale[0]
    height = emu(shape.height) * scale[1]
    try:
        shape_type = str(shape.shape_type)
    except Exception:
        shape_type = "UNKNOWN"
    has_text = bool(getattr(shape, "has_text_frame", False))
    text = shape.text_frame.text if has_text else ""
    try:
        rotation = float(shape.rotation or 0.0)
    except Exception:
        rotation = 0.0
    entry = {
        "shapeId": emu(shape.shape_id),
        "name": str(shape.name),
        "type": shape_type,
        "isPlaceholder": bool(getattr(shape, "is_placeholder", False)),
        "left": int(round(left)),
        "top": int(round(top)),
        "width": int(round(width)),
        "height": int(round(height)),
        "rotation": rotation,
        "hasText": has_text,
        "textPreview": text[:120],
        "textSha1": sha1_16(text) if text else "",
        "text": text[:4000] if text else "",
        "paragraphCount": len(shape.text_frame.paragraphs) if has_text else 0,
        "font": font_info(shape),
        "groupPath": list(group_path),
    }
    if getattr(shape, "has_table", False):
        entry["hasTable"] = True
        entry["table"] = table_info(shape)
    if getattr(shape, "has_chart", False):
        entry["hasChart"] = True
        entry["chart"] = chart_info(shape)
    if getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.PICTURE:
        entry["hasPicture"] = True
    entry["editable"] = len(group_path) == 0 and not entry.get("hasPicture", False)
    out.append(entry)

    if getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.GROUP:
        try:
            child_offset, child_scale = group_transform(shape, (left, top), scale)
        except Exception:
            child_offset, child_scale = (left, top), scale
        child_path = list(group_path) + [str(shape.name)]
        for child in shape.shapes:
            flatten_shape(child, child_offset, child_scale, child_path, out)


def dump_deck(path: str) -> dict:
    prs = Presentation(path)
    slides = []
    for index, slide in enumerate(prs.slides):
        shapes = []
        for shape in slide.shapes:
            flatten_shape(shape, (0.0, 0.0), (1.0, 1.0), [], shapes)
        notes = ""
        try:
            if slide.has_notes_slide:
                notes = slide.notes_slide.notes_text_frame.text
        except Exception:
            notes = ""
        slide_text = "\n".join(shape.get("textPreview", "") for shape in shapes if shape.get("hasText"))
        slides.append({
            "index": index,
            "slideId": int(slide.slide_id),
            "notes": notes[:10000],
            "textSha1": sha1_16(slide_text),
            "shapes": shapes,
        })
    return {
        "slideWidthEmu": emu(prs.slide_width),
        "slideHeightEmu": emu(prs.slide_height),
        "slideCount": len(prs.slides),
        "slides": slides,
    }


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: inventory.py <deck.pptx> <out.json>", file=sys.stderr)
        return 2
    path, out_path = sys.argv[1], sys.argv[2]
    data = dump_deck(path)
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps({
        "ok": True,
        "slideCount": data["slideCount"],
        "slideWidthEmu": data["slideWidthEmu"],
        "slideHeightEmu": data["slideHeightEmu"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
