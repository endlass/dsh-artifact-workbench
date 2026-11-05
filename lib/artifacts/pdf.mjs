import { readAnnotations, mutateAnnotations } from '../annotations.mjs';
import { ensurePdfDeck, readSlidePng } from '../render.mjs';

export const pdfAdapter = {
  id: 'pdf',
  format: 'pdf',
  extensions: ['.pdf'],
  editable: false,
  capabilities: { preview: true, annotate: true, edit: false, nativeOpen: true },
  async load({ path, sha, info }) {
    const deck = await ensurePdfDeck(path, sha, info);
    deck.deck.format = 'pdf';
    deck.deck.editable = false;
    return deck;
  },
  async readAnnotations({ path, sha, inventory }) {
    return readAnnotations(path, sha, inventory);
  },
  async mutateAnnotations({ path, sha, inventory, payload, author }) {
    return mutateAnnotations(path, sha, inventory, payload, author);
  },
  async readSlide(sha, page) {
    return readSlidePng(sha, page);
  },
  async capabilitiesFor() {
    return { format: 'pdf', editable: false, annotate: true, nativeOpen: true };
  },
};
