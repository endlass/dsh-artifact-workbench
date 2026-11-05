/**
 * Bridge injected into an H5 artifact served by the Artifact Workbench.
 * It never intercepts normal browsing: clicks are only captured while the
 * parent enables annotation mode.
 */
(function () {
  'use strict';
  if (window.parent === window) return;
  var annotate = false;
  function send(payload) {
    try { window.parent.postMessage(JSON.stringify(payload), '*'); } catch (error) { /* noop */ }
  }
  function docHeight() {
    return Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, document.body ? document.body.scrollHeight : 0, window.innerHeight || 1);
  }
  function ready() {
    send({
      event: 'dsh-html-ready',
      title: document.title || '',
      scrollHeight: docHeight(),
      scrollY: window.scrollY || 0,
      viewportWidth: window.innerWidth || 1,
      viewportHeight: window.innerHeight || 1,
    });
  }
  function onScroll() {
    send({ event: 'dsh-html-scroll', scrollY: window.scrollY || 0, scrollHeight: docHeight() });
  }
  function selectorOf(element) {
    if (!element || element.nodeType !== 1) return '';
    if (element.id) return '#' + CSS.escape(element.id);
    var parts = [];
    var node = element;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      var index = 1;
      var sibling = node;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) index += 1;
      }
      parts.unshift(tag + ':nth-of-type(' + index + ')');
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  }
  function textOf(element) {
    var text = element && typeof element.innerText === 'string' ? element.innerText : element ? element.textContent || '' : '';
    return String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  function pick(event) {
    if (!annotate) return;
    var element = event.target;
    if (!element || element.nodeType !== 1) return;
    if (element.closest('script,style,link,meta')) return;
    event.preventDefault();
    event.stopPropagation();
    var rect = element.getBoundingClientRect();
    var height = docHeight();
    var y = (window.scrollY || 0) + rect.top + rect.height / 2;
    send({
      event: 'dsh-html-pick',
      selector: selectorOf(element),
      textQuote: textOf(element),
      tag: element.tagName ? element.tagName.toLowerCase() : '',
      xNorm: Math.min(1, Math.max(0, (rect.left + rect.width / 2) / Math.max(1, window.innerWidth))),
      yNorm: Math.min(1, Math.max(0, y / Math.max(1, height))),
      scrollY: window.scrollY || 0,
      viewportWidth: window.innerWidth || 1,
      viewportHeight: window.innerHeight || 1,
    });
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (error) { return; } }
    if (!data || typeof data !== 'object') return;
    if (data.action === 'dsh-html-annotate') {
      annotate = !!data.on;
      document.documentElement.style.cursor = annotate ? 'crosshair' : '';
    }
    if (data.action === 'dsh-html-scroll-to' && typeof data.yNorm === 'number') {
      var target = Math.min(1, Math.max(0, data.yNorm)) * docHeight() - window.innerHeight / 2;
      window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  });
  window.addEventListener('load', function () { setTimeout(ready, 0); });
  window.addEventListener('scroll', onScroll, { passive: true });
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(ready, 0);
  document.addEventListener('click', pick, true);
})();
