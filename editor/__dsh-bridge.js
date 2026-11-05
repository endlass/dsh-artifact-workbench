/**
 * DSH Artifact Workbench bridge injected into the vendored draw.io editor.
 *
 * The editor keeps its EditorUi instance in a closure. This file wraps the
 * exported constructor before the app creates its instance, captures that
 * instance, and forwards the current cell selection to the parent. It also
 * accepts a select request from the parent. Everything is guarded: if draw.io
 * changes shape, the editor still runs and only the selection bridge is absent.
 */
(function () {
  'use strict';
  if (window.parent === window) return;

  var attached = null;
  var selectionListener = null;

  function send(payload) {
    try {
      window.parent.postMessage(JSON.stringify(payload), '*');
    } catch (error) {
      /* noop */
    }
  }

  function labelOf(cell) {
    if (!cell) return '';
    var value = cell.value;
    if (value === null || value === undefined) return '';
    var text = String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 300);
  }

  function infoOf(cell) {
    return {
      id: String(cell.id || ''),
      label: labelOf(cell),
      vertex: !!cell.vertex,
      edge: !!cell.edge,
    };
  }

  function report() {
    if (!attached || !attached.editor || !attached.editor.graph) return;
    var graph = attached.editor.graph;
    var cells;
    try {
      cells = graph.getSelectionCells() || [];
    } catch (error) {
      cells = [];
    }
    send({ event: 'dsh-selection', cells: cells.map(infoOf) });
  }

  function attach(ui) {
    if (!ui || !ui.editor || !ui.editor.graph) return;
    attached = ui;
    window.__dshEditorUi = ui;
    try {
      var graph = ui.editor.graph;
      if (selectionListener && selectionListener.graph && selectionListener.graph.selectionModel) {
        selectionListener.graph.selectionModel.removeListener(selectionListener.listener);
      }
      var listener = function () { report(); };
      graph.selectionModel.addListener('change', listener);
      selectionListener = { graph: graph, listener: listener };
      report();
    } catch (error) {
      /* noop */
    }
  }

  function wrap() {
    var EditorUi = window.EditorUi;
    var proto = EditorUi && EditorUi.prototype;
    if (!proto || proto.__dshBridgeInit) return false;
    var originalInit = proto.init;
    if (typeof originalInit !== 'function') return false;
    proto.init = function () {
      var result = originalInit.apply(this, arguments);
      setTimeout(function () { attach(this); }.bind(this), 0);
      attach(this);
      return result;
    };
    proto.__dshBridgeInit = true;
    return true;
  }

  wrap();
  window.addEventListener('load', function () {
    wrap();
    setTimeout(function () {
      if (!attached) {
        // Some builds create the UI before the constructor is wrapped. Look for
        // it on the editor's known containers as a last resort.
        var candidates = [window.editorUi, window.ui, window.app];
        for (var i = 0; i < candidates.length; i++) {
          if (candidates[i] && candidates[i].editor) attach(candidates[i]);
        }
      }
      report();
    }, 800);
  });

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (error) {
        return;
      }
    }
    if (!data || typeof data !== 'object') return;
    if (data.action === 'dsh-select' && attached) {
      try {
        var graph = attached.editor.graph;
        var model = graph.getModel();
        var ids = Array.isArray(data.cellIds) ? data.cellIds : data.cellId ? [data.cellId] : [];
        var cells = ids.map(function (id) { return model.getCell(String(id)); }).filter(Boolean);
        if (cells.length > 0) {
          graph.setSelectionCells(cells);
          if (cells.length === 1) graph.scrollCellToVisible(cells[0], true);
          report();
        }
      } catch (error) {
        /* noop */
      }
    }
  });
})();
