#!/usr/bin/env python3
"""Apply a whitelisted batch of structure edits to a .pptx and save to a new path.

Usage: python3 edit_ops.py <deck.pptx> <ops.json> <out.pptx>

The Host owns locking, sha validation, atomic replace, backups and undo/redo.
This script only reads the source, applies ops, and saves a new file (out must not exist).
Prints a JSON report on stdout; on op failure prints {"ok":false,"opIndex":i,...} and exits 1.
"""
from __future__ import annotations

import json
import sys
from copy import deepcopy

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.opc.package import PackURI
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

MAX_TEXT = 4000
MAX_NOTES = 10000
MAX_CELL = 1000
MAX_OPS = 100


class OpError(Exception):
    def __init__(self, op_index: int, message: str):
        super().__init__(message)
        self.op_index = op_index
        self.message = message


def slide_at(prs, index):
    if not isinstance(index, int) or index < 0 or index >= len(prs.slides):
        raise ValueError(f"slideIndex out of range: {index}")
    return prs.slides[index]


def find_top_shape(slide, shape_id):
    if not isinstance(shape_id, int):
        raise ValueError("shapeId must be an integer")
    for shape in slide.shapes:
        if int(shape.shape_id) == shape_id:
            return shape
    raise ValueError(f"shape not found on this slide: {shape_id} (only top-level shapes are editable)")


def require_text(value, limit, field):
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    if len(value) > limit:
        raise ValueError(f"{field} is too long (>{limit})")
    return value


def copy_run_format(source_run, target_run):
    try:
        rPr = source_run._r.rPr
        if rPr is None:
            return
        new_rPr = deepcopy(rPr)
        existing = target_run._r.rPr
        if existing is not None:
            target_run._r.remove(existing)
        target_run._r.insert(0, new_rPr)
    except Exception:
        pass


def op_set_text(prs, shape, params, warnings):
    if getattr(shape, "has_table", False) or getattr(shape, "has_chart", False):
        raise ValueError("use setTableCell/setChartData for tables and charts")
    if not getattr(shape, "has_text_frame", False):
        raise ValueError("shape has no text frame")
    text = require_text(params.get("text", ""), MAX_TEXT, "text")
    tf = shape.text_frame
    template_run = None
    template_pPr = None
    try:
        if len(tf.paragraphs) > 0:
            template_pPr = tf.paragraphs[0]._p.pPr
            template_pPr = deepcopy(template_pPr) if template_pPr is not None else None
            for paragraph in tf.paragraphs:
                for run in paragraph.runs:
                    if run.text and run.text.strip():
                        template_run = run
                        break
                if template_run is not None:
                    break
    except Exception:
        template_run = None
    tf.clear()
    lines = text.split("\n")
    first = tf.paragraphs[0]
    if template_pPr is not None:
        existing = first._p.pPr
        if existing is not None:
            first._p.remove(existing)
        first._p.insert(0, deepcopy(template_pPr))
    for line_index, line in enumerate(lines):
        paragraph = first if line_index == 0 else tf.add_paragraph()
        run = paragraph.add_run()
        run.text = line
        if template_run is not None:
            copy_run_format(template_run, run)


def op_set_font(prs, shape, params, warnings):
    if not getattr(shape, "has_text_frame", False):
        raise ValueError("shape has no text frame")
    size_pt = params.get("sizePt")
    bold = params.get("bold")
    italic = params.get("italic")
    color = params.get("color")
    if size_pt is not None:
        size_pt = float(size_pt)
        if size_pt <= 0 or size_pt > 400:
            raise ValueError("sizePt out of range")
    if color is not None:
        if not isinstance(color, str) or len(color) != 6:
            raise ValueError("color must be RRGGBB")
        try:
            int(color, 16)
        except ValueError:
            raise ValueError("color must be RRGGBB")
    changed = 0
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            if size_pt is not None:
                run.font.size = Pt(size_pt)
            if bold is not None:
                run.font.bold = bool(bold)
            if italic is not None:
                run.font.italic = bool(italic)
            if color is not None:
                run.font.color.rgb = RGBColor.from_string(color)
            changed += 1
    if changed == 0:
        warnings.append("setFont: shape has no text runs; nothing changed")
    return changed


def op_set_shape_box(prs, shape, params, warnings):
    for field in ("left", "top", "width", "height"):
        if field in params and params[field] is not None:
            value = params[field]
            if not isinstance(value, int) or value < 0 or value > 100_000_000:
                raise ValueError(f"{field} must be a non-negative EMU integer")
    if "left" in params and params["left"] is not None:
        shape.left = Emu(int(params["left"]))
    if "top" in params and params["top"] is not None:
        shape.top = Emu(int(params["top"]))
    if "width" in params and params["width"] is not None:
        shape.width = Emu(int(params["width"]))
    if "height" in params and params["height"] is not None:
        shape.height = Emu(int(params["height"]))


def op_set_notes(prs, slide, params, warnings):
    text = require_text(params.get("text", ""), MAX_NOTES, "text")
    slide.notes_slide.notes_text_frame.text = text


def op_set_table_cell(prs, shape, params, warnings):
    if not getattr(shape, "has_table", False):
        raise ValueError("shape is not a table")
    row = params.get("row")
    col = params.get("col")
    if not isinstance(row, int) or not isinstance(col, int):
        raise ValueError("row/col must be integers")
    table = shape.table
    if row < 0 or row >= len(table.rows) or col < 0 or col >= len(table.columns):
        raise ValueError("row/col out of range")
    text = require_text(params.get("text", ""), MAX_CELL, "text")
    table.cell(row, col).text = text


def op_set_chart_data(prs, shape, params, warnings):
    if not getattr(shape, "has_chart", False):
        raise ValueError("shape is not a chart")
    categories = params.get("categories")
    series_list = params.get("series")
    if not isinstance(categories, list) or not isinstance(series_list, list):
        raise ValueError("categories/series must be arrays")
    if not (1 <= len(categories) <= 24):
        raise ValueError("categories must have 1..24 items")
    chart_data = CategoryChartData()
    chart_data.categories = [str(item) for item in categories]
    for index, entry in enumerate(series_list[:6]):
        if not isinstance(entry, dict):
            raise ValueError("series entries must be objects")
        values = entry.get("values")
        if not isinstance(values, list) or len(values) != len(categories):
            raise ValueError("each series values length must match categories")
        numbers = []
        for value in values:
            if not isinstance(value, (int, float)):
                raise ValueError("series values must be numbers")
            numbers.append(float(value))
        chart_data.add_series(str(entry.get("name") or f"Series {index + 1}"), numbers)
    shape.chart.replace_data(chart_data)


def op_delete_shape(prs, shape, params, warnings):
    element = shape._element
    parent = element.getparent()
    if parent is None:
        raise ValueError("shape has no parent")
    parent.remove(element)


def ensure_unique_slide_partname(prs, slide):
    """python-pptx's next_partname can reuse a gap that is still serialized; rename on collision."""
    names = [str(part.partname) for part in prs.part.package.iter_parts()]
    current = str(slide.part.partname)
    if names.count(current) <= 1:
        return
    used = set(names)
    index = 1
    while f"/ppt/slides/slide{index}.xml" in used:
        index += 1
    slide.part.partname = PackURI(f"/ppt/slides/slide{index}.xml")


def find_blank_layout(prs):
    for layout in prs.slide_layouts:
        if "blank" in str(layout.name).lower():
            return layout
    try:
        return prs.slide_layouts[6]
    except Exception:
        return prs.slide_layouts[0]


def move_slide_xml(prs, slide, to_index):
    sldIdLst = prs.slides._sldIdLst
    entries = list(sldIdLst)
    target = None
    for entry in entries:
        rId = entry.get(qn("r:id"))
        if rId is not None and prs.part.rels[rId].target_part is slide.part:
            target = entry
            break
    if target is None:
        raise ValueError("cannot locate slide XML")
    sldIdLst.remove(target)
    entries = list(sldIdLst)
    if to_index < 0:
        to_index = 0
    if to_index > len(entries):
        to_index = len(entries)
    sldIdLst.insert(to_index, target)


def op_duplicate_slide(prs, slide, params, warnings):
    index = params.get("slideIndex")
    new_slide = prs.slides.add_slide(slide.slide_layout)
    ensure_unique_slide_partname(prs, new_slide)
    for shape in list(new_slide.shapes):
        if shape._element.getparent() is not None:
            shape._element.getparent().remove(shape._element)

    rel_ids = {}
    for rId, rel in list(slide.part.rels.items()):
        reltype = str(rel.reltype)
        if reltype.endswith("/slideLayout") or reltype.endswith("/notesSlide"):
            continue
        if rel.is_external:
            new_rId = new_slide.part.relate_to(rel.target_ref, rel.reltype, is_external=True)
        else:
            new_rId = new_slide.part.relate_to(rel.target_part, rel.reltype)
        rel_ids[rId] = new_rId

    src_tree = slide.shapes._spTree
    dst_tree = new_slide.shapes._spTree
    for child in src_tree:
        if child.tag in (qn("p:nvGrpSpPr"), qn("p:grpSpPr")):
            continue
        dst_tree.append(deepcopy(child))

    for element in dst_tree.iter():
        for attr in ("embed", "id", "link", "pict"):
            key = qn("r:" + attr)
            value = element.get(key)
            if value is not None and value in rel_ids:
                element.set(key, rel_ids[value])

    try:
        if slide.has_notes_slide:
            new_slide.notes_slide.notes_text_frame.text = slide.notes_slide.notes_text_frame.text
    except Exception:
        warnings.append("duplicateSlide: speaker notes could not be copied")

    move_slide_xml(prs, new_slide, index + 1)
    return new_slide


def op_delete_slide(prs, slide, params, warnings):
    if len(prs.slides) <= 1:
        raise ValueError("cannot delete the last slide")
    index = params.get("slideIndex")
    sldIdLst = prs.slides._sldIdLst
    entries = list(sldIdLst)
    target = None
    for entry in entries:
        rId = entry.get(qn("r:id"))
        if rId is not None and prs.part.rels[rId].target_part is slide.part:
            target = entry
            break
    if target is None:
        raise ValueError("cannot locate slide XML")
    rId = target.get(qn("r:id"))
    sldIdLst.remove(target)
    if rId is not None:
        prs.part.drop_rel(rId)


def op_move_slide(prs, slide, params, warnings):
    to_index = params.get("toIndex")
    if not isinstance(to_index, int):
        raise ValueError("toIndex must be an integer")
    if to_index < 0 or to_index >= len(prs.slides):
        raise ValueError("toIndex out of range")
    move_slide_xml(prs, slide, to_index)


def op_insert_slide(prs, slide, params, warnings):
    after_index = params.get("afterIndex", -1)
    if not isinstance(after_index, int) or after_index < -1:
        raise ValueError("afterIndex must be an integer >= -1")
    layout = find_blank_layout(prs)
    new_slide = prs.slides.add_slide(layout)
    ensure_unique_slide_partname(prs, new_slide)
    move_slide_xml(prs, new_slide, after_index + 1)


def apply_op(prs, index, params, warnings):
    op = params.get("op")
    if not isinstance(op, str):
        raise ValueError("op must be a string")

    if op == "duplicateSlide":
        op_duplicate_slide(prs, slide_at(prs, params.get("slideIndex")), params, warnings)
        return
    if op == "deleteSlide":
        op_delete_slide(prs, slide_at(prs, params.get("slideIndex")), params, warnings)
        return
    if op == "moveSlide":
        op_move_slide(prs, slide_at(prs, params.get("slideIndex")), params, warnings)
        return
    if op == "insertSlide":
        op_insert_slide(prs, None, params, warnings)
        return
    if op == "setNotes":
        op_set_notes(prs, slide_at(prs, params.get("slideIndex")), params, warnings)
        return

    slide = slide_at(prs, params.get("slideIndex"))
    shape = find_top_shape(slide, params.get("shapeId"))
    if op == "setText":
        op_set_text(prs, shape, params, warnings)
    elif op == "setFont":
        op_set_font(prs, shape, params, warnings)
    elif op == "setShapeBox":
        op_set_shape_box(prs, shape, params, warnings)
    elif op == "setTableCell":
        op_set_table_cell(prs, shape, params, warnings)
    elif op == "setChartData":
        op_set_chart_data(prs, shape, params, warnings)
    elif op == "deleteShape":
        op_delete_shape(prs, shape, params, warnings)
    else:
        raise ValueError(f"unsupported op: {op}")


def validate_ops(ops):
    if not isinstance(ops, list) or len(ops) == 0:
        raise OpError(0, "ops must be a non-empty array")
    if len(ops) > MAX_OPS:
        raise OpError(0, f"too many ops (>{MAX_OPS})")
    for index, params in enumerate(ops):
        if not isinstance(params, dict):
            raise OpError(index, "op must be an object")
        op = params.get("op")
        allowed = {
            "setText", "setFont", "setShapeBox", "setNotes", "setTableCell",
            "setChartData", "deleteShape", "duplicateSlide", "deleteSlide",
            "moveSlide", "insertSlide",
        }
        if op not in allowed:
            raise OpError(index, f"unsupported op: {op!r}")
    return ops


def main() -> int:
    if len(sys.argv) != 4:
        print(json.dumps({"ok": False, "error": "usage: edit_ops.py <deck> <ops.json> <out>"}))
        return 2
    deck_path, ops_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        with open(ops_path, "r", encoding="utf-8") as handle:
            ops = validate_ops(json.load(handle))
        prs = Presentation(deck_path)
        warnings = []
        for index, params in enumerate(ops):
            try:
                apply_op(prs, index, params, warnings)
            except OpError:
                raise
            except Exception as error:  # noqa: BLE001 - op failures are data errors
                raise OpError(index, str(error))
        prs.save(out_path)
        print(json.dumps({
            "ok": True,
            "applied": len(ops),
            "warnings": warnings[:20],
            "slideCount": len(prs.slides),
        }, ensure_ascii=False))
        return 0
    except OpError as error:
        print(json.dumps({"ok": False, "opIndex": error.op_index, "message": error.message}, ensure_ascii=False))
        return 1
    except Exception as error:  # noqa: BLE001 - report as a single failure
        print(json.dumps({"ok": False, "opIndex": None, "message": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
