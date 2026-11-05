import { readAnnotations, mutateAnnotations, readHtmlAnnotations, mutateHtmlAnnotations } from '../annotations.mjs';
import { ensureHtmlDeck, readSlidePng } from '../render.mjs';

export const htmlAdapter = {
  id: 'html',
  format: 'pdf',
  extensions: ['.html', '.htm'],
  editable: false,
  capabilities: { preview: true, annotate: true, edit: false, nativeOpen: false, snapshot: true },
  async load({ path, sha, info }) {
    const deck = await ensureHtmlDeck(path, sha, info);
    deck.deck.format = 'pdf';
    deck.deck.sourceFormat = 'html';
    deck.deck.editable = false;
    deck.deck.snapshot = true;
    return deck;
  },
  async readAnnotations({ path, sha, inventory }) {
    return readHtmlAnnotations(path, sha);
  },
  async mutateAnnotations({ path, sha, inventory, payload, author }) {
    return mutateHtmlAnnotations(path, sha, payload, author);
  },
  async readSlide(sha, page) {
    return readSlidePng(sha, page);
  },
  async capabilitiesFor() {
    return { format: 'pdf', sourceFormat: 'html', editable: false, annotate: true, snapshot: true };
  },
};
