import { diagramAdapter } from './diagram.mjs';
import { htmlAdapter } from './html.mjs';
import { pdfAdapter } from './pdf.mjs';
import { pptxAdapter } from './pptx.mjs';
import { adapterForPath, listArtifactAdapters, registerArtifactAdapter } from './registry.mjs';

for (const adapter of [pptxAdapter, pdfAdapter, htmlAdapter, diagramAdapter]) {
  if (!listArtifactAdapters().some((entry) => entry.id === adapter.id)) {
    registerArtifactAdapter(adapter);
  }
}

export { adapterForPath, listArtifactAdapters, registerArtifactAdapter };
export { diagramAdapter, htmlAdapter, pdfAdapter, pptxAdapter };
