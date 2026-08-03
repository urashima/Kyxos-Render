import { createGlbImportReport } from './glb-report';

interface GlbWorkerRequest {
  buffer: ArrayBuffer;
  name: string;
}

self.onmessage = (event: MessageEvent<GlbWorkerRequest>) => {
  try {
    postMessage({
      ok: true,
      result: createGlbImportReport(event.data.buffer, event.data.name),
    });
  } catch (error) {
    postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
