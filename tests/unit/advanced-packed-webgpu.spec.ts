import { describe, expect, it } from 'vitest';
import {
  ADVANCED_STORAGE_BUFFERS_PER_STAGE,
  resolveAdvancedRendererCapabilities,
} from '../../packages/viewer/src/render/advanced/backendCapabilities';
import {
  advancedPathTracingComputeWGSL,
  advancedPathTracingDisplayWGSL,
  findReservedWGSLIdentifiers,
} from '../../packages/viewer/src/render/advanced/webgpuShadersPortable';

describe('packed WebGPU advanced renderer', () => {
  it('targets the WebGPU baseline of eight storage buffers per shader stage', () => {
    expect(ADVANCED_STORAGE_BUFFERS_PER_STAGE).toBe(8);
    const capability = resolveAdvancedRendererCapabilities('webgpu', {
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
      maxComputeWorkgroupStorageSize: 16 * 1024,
      maxComputeInvocationsPerWorkgroup: 256,
      maxStorageBuffersPerShaderStage: 8,
    });
    expect(capability.softwareRayQuery).toBe(true);
    expect(capability.pathTracing).toBe(true);
  });

  it('contains exactly eight compute storage buffers and no legacy binding 9+', () => {
    const storageBindings = [...advancedPathTracingComputeWGSL.matchAll(/@group\(0\) @binding\((\d+)\) var<storage/g)]
      .map((match) => Number(match[1]));
    expect(storageBindings).toHaveLength(8);
    expect(Math.max(...storageBindings)).toBe(8);
    expect(advancedPathTracingComputeWGSL).not.toContain('@binding(9)');
    expect(advancedPathTracingComputeWGSL).not.toContain('@binding(15)');
    expect(advancedPathTracingComputeWGSL).toContain('staticScene: array<vec4<f32>>');
    expect(advancedPathTracingComputeWGSL).toContain('dynamicScene: array<vec4<f32>>');
  });

  it('removes every identifier reserved by the current WGSL grammar', () => {
    expect(findReservedWGSLIdentifiers(advancedPathTracingComputeWGSL)).toEqual([]);
    expect(findReservedWGSLIdentifiers(advancedPathTracingDisplayWGSL)).toEqual([]);
    expect(advancedPathTracingComputeWGSL).toContain('nodeInfo');
    expect(advancedPathTracingComputeWGSL).toContain('targetValue');
  });

  it('normalizes ReSTIR selected radiance exactly once by the proposal PDF', () => {
    expect(advancedPathTracingComputeWGSL).toContain('let selectedContribution = selected.radiancePdf.rgb * evaluateBrdf(');
    expect(advancedPathTracingComputeWGSL).toContain('return selectedContribution * reservoirFinalWeight(reservoir);');
    expect(advancedPathTracingComputeWGSL).not.toContain('return evaluateCandidate(hit, viewDirection, selected) * reservoirFinalWeight(reservoir);');
  });

  it('uses packed accessors instead of the legacy scene-buffer arrays', () => {
    expect(advancedPathTracingComputeWGSL).toContain('fn loadTriangle(');
    expect(advancedPathTracingComputeWGSL).toContain('fn loadBvhNode(');
    expect(advancedPathTracingComputeWGSL).toContain('fn loadInstance(');
    expect(advancedPathTracingComputeWGSL).toContain('fn loadTlasNode(');
    expect(advancedPathTracingComputeWGSL).not.toMatch(/\btriangles\[/);
    expect(advancedPathTracingComputeWGSL).not.toMatch(/\bnodes\[/);
    expect(advancedPathTracingComputeWGSL).not.toMatch(/\binstances\[/);
    expect(advancedPathTracingComputeWGSL).not.toMatch(/\btlasNodes\[/);
  });
});
