import { readAnnotations, mutateAnnotations, readDrawioAnnotations, mutateDrawioAnnotations } from '../annotations.mjs';
import { ensureDiagramDeck, readSlidePng } from '../render.mjs';

export const diagramAdapter = {
  id: 'diagram',
  format: 'pdf',
  extensions: ['.drawio', '.mmd', '.mermaid'],
  editable: false,
  capabilities: { preview: true, annotate: true, edit: false, nativeOpen: true, snapshot: true },
  async load({ path, sha, info }) {
    const deck = await ensureDiagramDeck(path, sha, info);
    deck.deck.format = 'pdf';
    deck.deck.editable = false;
    return deck;
  },
  async readAnnotations({ path, sha, inventory, writeAllowed }) {
    if (/\.drawio$/i.test(path)) return readDrawioAnnotations(path, sha, { writeAllowed });
    return readAnnotations(path, sha, inventory, { writeAllowed });
  },
  async mutateAnnotations({ path, sha, inventory, payload, author }) {
    if (/\.drawio$/i.test(path)) return mutateDrawioAnnotations(path, sha, payload, author);
    return mutateAnnotations(path, sha, inventory, payload, author);
  },
  async readSlide(sha, page) {
    return readSlidePng(sha, page);
  },
  async capabilitiesFor() {
    return { format: 'pdf', sourceFormat: 'diagram', editable: false, annotate: true, nativeOpen: true };
  },
};
