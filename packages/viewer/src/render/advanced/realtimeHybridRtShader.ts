import { realtimeHybridRtWGSL as generatedHybridRtWGSL } from './realtimeHybridRtRayShader';

const SMOOTH_TRIANGLE_STRIDE_SOURCE = 'u32(globals.staticLayout0.x) + indexValue * 4u';
if (!generatedHybridRtWGSL.includes(SMOOTH_TRIANGLE_STRIDE_SOURCE)) {
  throw new Error('Hybrid RT smooth-normal triangle stride migration did not match the pinned shader.');
}

export const realtimeHybridRtWGSL = generatedHybridRtWGSL.replace(
  SMOOTH_TRIANGLE_STRIDE_SOURCE,
  'u32(globals.staticLayout0.x) + indexValue * 7u',
);
