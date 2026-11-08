import { readAnnotations, mutateAnnotations } from '../annotations.mjs';
import { ensureDeck, readSlidePng } from '../render.mjs';

export const pptxAdapter = {
  id: 'pptx',
  format: 'pptx',
  extensions: ['.pptx'],
  editable: true,
  capabilities: { preview: true, annotate: true, edit: true, nativeOpen: true },
  async load({ path, sha, info }) {
    const deck = await ensureDeck(path, sha, info);
    deck.deck.format = 'pptx';
    deck.deck.editable = true;
    return deck;
  },
  async readAnnotations({ path, sha, inventory, writeAllowed }) {
    return readAnnotations(path, sha, inventory, { writeAllowed });
  },
  async mutateAnnotations({ path, sha, inventory, payload, author }) {
    return mutateAnnotations(path, sha, inventory, payload, author);
  },
  async readSlide(sha, page) {
    return readSlidePng(sha, page);
  },
  async capabilitiesFor() {
    return { format: 'pptx', editable: true, annotate: true, nativeOpen: true };
  },
};
