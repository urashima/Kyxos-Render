import {
  advancedPathTracingComputeWGSL as generatedComputeWGSL,
  advancedPathTracingDisplayWGSL as generatedDisplayWGSL,
} from './webgpuShaders';

/**
 * WGSL reserves a number of identifiers for future language use. `meta` is one
 * of those reserved words in current browser compilers, while older Dawn builds
 * accepted it. Keep the final shader text portable regardless of which pinned
 * migration block introduced the identifier.
 */
const RESERVED_IDENTIFIER_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['meta', 'nodeInfo'],
];

export function sanitizePortableWGSL(source: string): string {
  let result = source;
  for (const [reserved, replacement] of RESERVED_IDENTIFIER_RENAMES) {
    result = result.replace(new RegExp(`\\b${reserved}\\b`, 'g'), replacement);
  }
  return result;
}

export const advancedPathTracingComputeWGSL = sanitizePortableWGSL(generatedComputeWGSL);
export const advancedPathTracingDisplayWGSL = sanitizePortableWGSL(generatedDisplayWGSL);
