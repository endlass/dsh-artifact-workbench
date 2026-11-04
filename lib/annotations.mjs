import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { errorText, log, readJsonFile, writeJsonFile } from './util.mjs';

export const ANNOTATION_SCHEMA = 'dsh-ppt-annotation@1';
const writeQueues = new Map();

async function withAnnotationWrite(deckPath, task) {
  const previous = writeQueues.get(deckPath) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  writeQueues.set(deckPath, tail);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (writeQueues.get(deckPath) === tail) writeQueues.delete(deckPath);
  }
}
const MAX_BODY = 10_000;
const MAX_REPLY = 5_000;

export function annotationDir(deckPath) {
  return `${deckPath}.workbench`;
}

export function annotationFile(deckPath) {
  return join(annotationDir(deckPath), 'annotations.json');
}

function emptyFile(deckPath, sha) {
  return {
    schema: ANNOTATION_SCHEMA,
    deck: { path: deckPath, sha256: sha || null, updatedAt: new Date().toISOString() },
    annotations: [],
  };
}

export async function loadAnnotationFile(deckPath, sha) {
  const file = await readJsonFile(annotationFile(deckPath), null);
  if (!file || file.schema !== ANNOTATION_SCHEMA || !Array.isArray(file.annotations)) {
    return emptyFile(deckPath, sha);
  }
  if (!file.deck || typeof file.deck !== 'object') {
    file.deck = { path: deckPath, sha256: sha || null, updatedAt: new Date().toISOString() };
  }
  return file;
}

export async function saveAnnotationFile(deckPath, file) {
  return withAnnotationWrite(deckPath, async () => {
    file.deck = {
      ...(file.deck || {}),
      path: deckPath,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(annotationFile(deckPath), file);
  });
}

function shapeCenter(shape) {
  return {
    x: shape.left + shape.width / 2,
    y: shape.top + shape.height / 2,
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestShape(slide, anchor, inventory) {
  const bbox = anchor.bboxEmu;
  if (!bbox || !Number.isFinite(bbox.left)) return null;
  const ref = { x: bbox.left + bbox.width / 2, y: bbox.top + bbox.height / 2 };
  const ranked = slide.shapes
    .map((shape) => ({ shape, d: distance(shapeCenter(shape), ref) }))
    .sort((a, b) => a.d - b.d);
  if (ranked.length === 0) return null;
  const best = ranked[0];
  const second = ranked[1];
  const diag = Math.sqrt(
    (inventory.slideWidthEmu || 1) ** 2 + (inventory.slideHeightEmu || 1) ** 2,
  );
  if (best.d / diag > 0.12) return null;
  if (second && second.d < best.d * 2.2) return null;
  return best.shape;
}

function matchAcrossSlides(inventory, annotation) {
  const anchor = annotation.anchor || {};
  const scored = [];
  for (const slide of inventory.slides) {
    for (const shape of slide.shapes) {
      let score = 0;
      if (anchor.shapeName && shape.name === anchor.shapeName) score += 2;
      if (anchor.textSha1 && shape.textSha1 === anchor.textSha1) score += 3;
      if (annotation.slideTextSha1 && slide.textSha1 === annotation.slideTextSha1) score += 1;
      if (score > 0) scored.push({ slide, shape, score });
    }
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0];
}

function shapeSummary(shape) {
  return {
    shapeId: shape.shapeId,
    name: shape.name,
    textSha1: shape.textSha1 || '',
    bboxEmu: {
      left: shape.left,
      top: shape.top,
      width: shape.width,
      height: shape.height,
    },
  };
}

function normBBoxToEmu(bbox, inventory) {
  if (!bbox || !Number.isFinite(bbox.x) || !Number.isFinite(bbox.y)) return null;
  const width = Number.isFinite(bbox.w) ? bbox.w : 0;
  const height = Number.isFinite(bbox.h) ? bbox.h : 0;
  return {
    left: Math.round(clamp01(bbox.x) * inventory.slideWidthEmu),
    top: Math.round(clamp01(bbox.y) * inventory.slideHeightEmu),
    width: Math.round(Math.max(0, width) * inventory.slideWidthEmu),
    height: Math.round(Math.max(0, height) * inventory.slideHeightEmu),
  };
}

function matchAnchor(annotation, inventory) {
  const anchor = annotation.anchor || {};
  const slides = inventory.slides || [];
  let slide =
    slides.find((entry) => entry.slideId === annotation.slideId) ||
    (Number.isInteger(annotation.slideIndex) ? slides[annotation.slideIndex] : undefined);

  const hasShapeHint =
    Number.isInteger(anchor.shapeId) ||
    (typeof anchor.shapeName === 'string' && anchor.shapeName.length > 0) ||
    (typeof anchor.textSha1 === 'string' && anchor.textSha1.length > 0);
  if (slide && !hasShapeHint && (anchor.bboxEmu || annotation.areaNorm)) {
    return { slide, shape: null, how: 'area' };
  }

  if (slide) {
    let shape = slide.shapes.find((entry) => entry.shapeId === anchor.shapeId);
    let how = 'shape-id';
    if (!shape && anchor.shapeName) {
      const matches = slide.shapes.filter((entry) => entry.name === anchor.shapeName);
      if (matches.length === 1) {
        shape = matches[0];
        how = 'shape-name';
      }
    }
    if (!shape && anchor.textSha1) {
      const matches = slide.shapes.filter(
        (entry) => entry.textSha1 && entry.textSha1 === anchor.textSha1,
      );
      if (matches.length === 1) {
        shape = matches[0];
        how = 'text-sha1';
      }
    }
    if (!shape) {
      shape = nearestShape(slide, anchor, inventory);
      if (shape) how = 'geometry';
    }
    if (shape) return { slide, shape, how };
  }

  const across = matchAcrossSlides(inventory, annotation);
  if (across) return { slide: across.slide, shape: across.shape, how: 'cross-slide' };
  return null;
}

function anchorFrom(slide, shape, pointNorm) {
  return {
    shapeId: shape.shapeId,
    shapeName: shape.name,
    textSha1: shape.textSha1 || '',
    bboxEmu: {
      left: shape.left,
      top: shape.top,
      width: shape.width,
      height: shape.height,
    },
    rotation: shape.rotation || 0,
    pointNorm:
      pointNorm && Number.isFinite(pointNorm.x) && Number.isFinite(pointNorm.y)
        ? { x: clamp01(pointNorm.x), y: clamp01(pointNorm.y) }
        : { x: 0.5, y: 0.5 },
    groupPath: Array.isArray(shape.groupPath) ? shape.groupPath : [],
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value)));
}

/**
 * Repair annotation anchors against the current inventory.
 * Returns new annotation array plus a report; never drops annotations.
 */
export function repairAnnotations(annotations, inventory, deckSha) {
  const report = { repaired: 0, orphaned: 0, items: [] };
  const repaired = annotations.map((annotation) => {
    if (!annotation || typeof annotation !== 'object') return annotation;
    const previous = {
      slideId: annotation.slideId,
      slideIndex: annotation.slideIndex,
      status: annotation.status,
      shapeId: annotation.anchor && annotation.anchor.shapeId,
    };
    const matched = matchAnchor(annotation, inventory);
    if (!matched) {
      if (annotation.status !== 'orphaned') {
        annotation.status = 'orphaned';
        annotation.orphanedAt = new Date().toISOString();
        annotation.history = appendHistory(annotation.history, {
          at: annotation.orphanedAt,
          type: 'orphaned',
          deckSha,
        });
        report.orphaned += 1;
        report.items.push({ id: annotation.id, from: previous, to: { status: 'orphaned' }, how: null });
      }
      return annotation;
    }
    const matchedShapeId = matched.shape ? matched.shape.shapeId : null;
    const previousShapeId = annotation.anchor ? annotation.anchor.shapeId : null;
    const changed =
      annotation.slideId !== matched.slide.slideId ||
      annotation.slideIndex !== matched.slide.index ||
      previousShapeId !== matchedShapeId ||
      annotation.status === 'orphaned';
    annotation.slideId = matched.slide.slideId;
    annotation.slideIndex = matched.slide.index;
    annotation.slideTextSha1 = matched.slide.textSha1;
    if (matched.shape) {
      annotation.anchor = {
        ...(annotation.anchor || {}),
        ...anchorFrom(matched.slide, matched.shape, annotation.anchor && annotation.anchor.pointNorm),
      };
      const previousShapes = Array.isArray(annotation.anchor.relatedShapes)
        ? annotation.anchor.relatedShapes
        : [];
      if (matched.shapeIds && matched.shapeIds.length > 0) {
        annotation.anchor.shapeIds = matched.shapeIds;
        annotation.anchor.relatedShapes = matched.shapeIds
          .map((shapeId) => matched.slide.shapes.find((entry) => entry.shapeId === shapeId))
          .filter(Boolean)
          .map(shapeSummary);
      } else if (previousShapes.length > 0) {
        const refreshed = previousShapes
          .map((entry) => {
            if (entry && Number.isInteger(entry.shapeId)) {
              const byId = matched.slide.shapes.find((shape) => shape.shapeId === entry.shapeId);
              if (byId) return shapeSummary(byId);
            }
            if (entry && entry.name) {
              const byName = matched.slide.shapes.find((shape) => shape.name === entry.name);
              if (byName) return shapeSummary(byName);
            }
            return entry;
          })
          .filter(Boolean);
        annotation.anchor.relatedShapes = refreshed;
        annotation.anchor.shapeIds = refreshed
          .filter((entry) => Number.isInteger(entry.shapeId))
          .map((entry) => entry.shapeId);
      }
    } else if (annotation.anchor && annotation.anchor.bboxEmu) {
      // Area annotation: only the slide needs to remain valid.
      annotation.anchor = { ...annotation.anchor };
    }
    if (annotation.status === 'orphaned') {
      annotation.status = 'open';
      delete annotation.orphanedAt;
    }
    if (changed) {
      annotation.history = appendHistory(annotation.history, {
        at: new Date().toISOString(),
        type: 'repaired',
        how: matched.how,
        deckSha,
        from: previous,
      });
      report.repaired += 1;
      report.items.push({
        id: annotation.id,
        from: previous,
        to: {
          slideId: matched.slide.slideId,
          slideIndex: matched.slide.index,
          shapeId: matchedShapeId,
        },
        how: matched.how,
      });
    }
    return annotation;
  });
  return { annotations: repaired, report };
}

function appendHistory(history, entry) {
  const list = Array.isArray(history) ? history.slice(-19) : [];
  list.push(entry);
  return list;
}

export function sortAnnotations(annotations) {
  return annotations
    .slice()
    .sort((a, b) => {
      const slideA = Number.isInteger(a.slideIndex) ? a.slideIndex : 1e9;
      const slideB = Number.isInteger(b.slideIndex) ? b.slideIndex : 1e9;
      if (slideA !== slideB) return slideA - slideB;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
}

export async function readAnnotations(deckPath, sha, inventory) {
  const file = await loadAnnotationFile(deckPath, sha);
  let repair = { repaired: 0, orphaned: 0, items: [] };
  const needsRepair = file.deck.sha256 !== sha && file.annotations.length > 0;
  if (needsRepair) {
    const result = repairAnnotations(file.annotations, inventory, sha);
    file.annotations = result.annotations;
    repair = result.report;
  }
  if (needsRepair || file.deck.sha256 !== sha) {
    file.deck.sha256 = sha;
    try {
      await saveAnnotationFile(deckPath, file);
    } catch (error) {
      // A repair write is a persistence side effect; never fail deck/edit reads because
      // two readers raced on the sidecar. The next read will try again.
      await log(`annotations save failed (non-fatal): ${errorText(error)}`);
    }
    if (needsRepair) {
      await log(
        `annotations repaired sha=${sha.slice(0, 12)} repaired=${repair.repaired} orphaned=${repair.orphaned}`,
      );
    }
  }
  return {
    deckSha: sha,
    annotations: sortAnnotations(file.annotations),
    repair,
  };
}

function assertBody(value, max) {
  if (typeof value !== 'string') throw new Error('body must be a string');
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error('body must not be empty');
  if (trimmed.length > max) throw new Error(`body must be at most ${max} characters`);
  return trimmed;
}

export function makeAnnotation({ inventory, payload, author, sha }) {
  const slideIndex = Number.isInteger(payload.slideIndex) ? payload.slideIndex : null;
  if (slideIndex === null || slideIndex < 0 || slideIndex >= inventory.slides.length) {
    throw new Error('slideIndex is out of range');
  }
  const slide = inventory.slides[slideIndex];
  const shapeIds = Array.isArray(payload.shapeIds)
    ? payload.shapeIds.filter((value) => Number.isInteger(value))
    : Number.isInteger(payload.shapeId)
      ? [payload.shapeId]
      : [];
  const shapes = shapeIds
    .map((shapeId) => slide.shapes.find((entry) => entry.shapeId === shapeId))
    .filter(Boolean);
  const primary = shapes.length > 0 ? shapes[shapes.length - 1] : null;
  const areaBBox =
    !primary && payload.bboxNorm ? normBBoxToEmu(payload.bboxNorm, inventory) : null;
  const point = payload.pointNorm && Number.isFinite(payload.pointNorm.x) && Number.isFinite(payload.pointNorm.y)
    ? { x: clamp01(payload.pointNorm.x), y: clamp01(payload.pointNorm.y) }
    : primary
      ? {
          x: (primary.left + primary.width / 2) / (inventory.slideWidthEmu || 1),
          y: (primary.top + primary.height / 2) / (inventory.slideHeightEmu || 1),
        }
      : { x: 0.5, y: 0.5 };
  const anchor = primary
    ? {
        ...anchorFrom(slide, primary, point),
        shapeIds: shapes.map((shape) => shape.shapeId),
        relatedShapes: shapes.map(shapeSummary),
      }
    : {
        shapeId: null,
        shapeName: null,
        textSha1: '',
        bboxEmu: areaBBox,
        rotation: 0,
        pointNorm: point,
        groupPath: [],
        shapeIds: [],
        relatedShapes: [],
        areaNorm: payload.bboxNorm || null,
      };
  const annotation = {
    id: randomUUID(),
    slideId: slide.slideId,
    slideIndex: slide.index,
    slideTextSha1: slide.textSha1,
    anchor,
    body: assertBody(payload.body, MAX_BODY),
    author: normalizeAuthor(author),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'open',
    resolvedAt: null,
    replies: [],
    history: [{ at: new Date().toISOString(), type: 'created', deckSha: sha }],
  };
  return annotation;
}

export function normalizeAuthor(author) {
  if (author && typeof author === 'object' && typeof author.name === 'string' && author.name.trim()) {
    return {
      id: typeof author.id === 'string' && author.id ? author.id : 'local',
      name: author.name.trim().slice(0, 120),
    };
  }
  return { id: 'local', name: '我' };
}

export function applyAnnotationOp(file, op, payload, context) {
  const { inventory, author, sha } = context;
  const annotations = file.annotations;
  const id = typeof payload.id === 'string' ? payload.id : '';
  const index = annotations.findIndex((entry) => entry && entry.id === id);

  if (op === 'create') {
    const annotation = makeAnnotation({ inventory, payload, author, sha });
    annotations.push(annotation);
    return { file, changed: annotation };
  }

  if (op === 'delete') {
    if (index < 0) throw new Error('annotation not found');
    const [removed] = annotations.splice(index, 1);
    return { file, changed: removed };
  }

  if (index < 0) throw new Error('annotation not found');
  const annotation = annotations[index];

  if (op === 'update') {
    annotation.body = assertBody(payload.body, MAX_BODY);
    annotation.updatedAt = new Date().toISOString();
    return { file, changed: annotation };
  }
  if (op === 'resolve' || op === 'reopen') {
    annotation.status = op === 'resolve' ? 'resolved' : 'open';
    annotation.resolvedAt = op === 'resolve' ? new Date().toISOString() : null;
    annotation.updatedAt = new Date().toISOString();
    return { file, changed: annotation };
  }
  if (op === 'reply') {
    annotation.replies = Array.isArray(annotation.replies) ? annotation.replies : [];
    annotation.replies.push({
      id: randomUUID(),
      body: assertBody(payload.body, MAX_REPLY),
      author: normalizeAuthor(author),
      createdAt: new Date().toISOString(),
    });
    annotation.updatedAt = new Date().toISOString();
    return { file, changed: annotation };
  }
  throw new Error(`unknown annotation op: ${op}`);
}

export async function mutateAnnotations(deckPath, sha, inventory, payload, author) {
  return withAnnotationWrite(deckPath, async () => {
  const file = await loadAnnotationFile(deckPath, sha);
  let repair = { repaired: 0, orphaned: 0, items: [] };
  if (file.deck.sha256 !== sha && file.annotations.length > 0) {
    const result = repairAnnotations(file.annotations, inventory, sha);
    file.annotations = result.annotations;
    repair = result.report;
  }
  const op = typeof payload.op === 'string' ? payload.op : 'create';
  applyAnnotationOp(file, op, payload, { inventory, author, sha });
  file.deck.sha256 = sha;
  await saveAnnotationFile(deckPath, file);
  return {
    deckSha: sha,
    annotations: sortAnnotations(file.annotations),
    repair,
  };
  });
}
