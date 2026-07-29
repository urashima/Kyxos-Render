import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCUMULATION_FRAMES,
  DEFAULT_STABILIZATION_FRAMES,
  RenderActivityMachine,
} from '../../packages/viewer/src/render/RenderActivityMachine';

function render(machine: RenderActivityMachine, hasStaticAccumulator = true) {
  const serial = machine.beginFrame();
  machine.completeFrame(serial, hasStaticAccumulator);
}

describe('render activity state machine', () => {
  it('uses the shipped convergence budgets by default', () => {
    expect(DEFAULT_STABILIZATION_FRAMES).toBe(8);
    expect(DEFAULT_ACCUMULATION_FRAMES).toBe(32);

    const machine = new RenderActivityMachine();
    expect(machine.stabilizationFrames).toBe(DEFAULT_STABILIZATION_FRAMES);
    expect(machine.accumulationFrames).toBe(DEFAULT_ACCUMULATION_FRAMES);
  });

  it('converges through stabilizing and accumulation before sleeping', () => {
    const machine = new RenderActivityMachine({
      stabilizationFrames: 2,
      accumulationFrames: 3,
    });

    render(machine);
    expect(machine.getState()).toBe('stabilizing');

    render(machine);
    render(machine);
    expect(machine.getState()).toBe('accumulating');
    expect(machine.getStaticSampleCount()).toBe(1);

    render(machine);
    expect(machine.getStaticSampleCount()).toBe(2);
    render(machine);
    expect(machine.getStaticSampleCount()).toBe(3);
    render(machine);
    expect(machine.getState()).toBe('sleeping');
    expect(machine.snapshot(false)).toMatchObject({
      reason: 'converged',
      staticSampleCount: 3,
      pendingAnimationFrame: false,
    });
  });

  it('skips static accumulation when TRAA is unavailable', () => {
    const machine = new RenderActivityMachine({
      stabilizationFrames: 1,
      accumulationFrames: 4,
    });

    render(machine, false);
    render(machine, false);
    expect(machine.getState()).toBe('sleeping');
    expect(machine.snapshot(false)).toMatchObject({
      reason: 'converged-without-static-mean',
      staticSampleCount: 1,
      pendingAnimationFrame: false,
    });
  });

  it('wakes from sleep on dirty activity and remains interactive during animation', () => {
    const machine = new RenderActivityMachine({
      stabilizationFrames: 1,
      accumulationFrames: 1,
    });

    render(machine);
    render(machine);
    render(machine);
    expect(machine.getState()).toBe('sleeping');

    machine.markActivity('effect:bloom');
    expect(machine.getState()).toBe('interactive');

    machine.setAnimationActive(true);
    for (let index = 0; index < 4; index += 1) render(machine);
    expect(machine.getState()).toBe('interactive');

    machine.setAnimationActive(false);
    expect(machine.getState()).toBe('stabilizing');
  });
});
