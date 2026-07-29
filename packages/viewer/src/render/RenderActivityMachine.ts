import type { RenderActivityState, ViewerActivitySnapshot } from '../types';

export const DEFAULT_STABILIZATION_FRAMES = 8;
export const DEFAULT_ACCUMULATION_FRAMES = 32;

export interface RenderActivityMachineOptions {
  stabilizationFrames?: number;
  accumulationFrames?: number;
}

export class RenderActivityMachine {
  private state: RenderActivityState = 'interactive';
  private reason = 'initialize';
  private stabilizationFrame = 0;
  private accumulationFrame = 0;
  private activitySerial = 0;
  private interactionActive = false;
  private animationActive = false;

  readonly stabilizationFrames: number;
  readonly accumulationFrames: number;

  constructor(options: RenderActivityMachineOptions = {}) {
    this.stabilizationFrames = Math.max(
      1,
      Math.round(options.stabilizationFrames ?? DEFAULT_STABILIZATION_FRAMES),
    );
    this.accumulationFrames = Math.max(
      1,
      Math.round(options.accumulationFrames ?? DEFAULT_ACCUMULATION_FRAMES),
    );
  }

  markActivity(reason: string) {
    this.activitySerial += 1;
    this.transition('interactive', reason);
  }

  beginInteraction(reason = 'camera') {
    this.interactionActive = true;
    this.markActivity(reason);
  }

  endInteraction(reason = 'interaction-ended') {
    this.interactionActive = false;
    if (!this.animationActive) this.transition('stabilizing', reason);
  }

  setAnimationActive(enabled: boolean) {
    this.animationActive = enabled;
    if (enabled) {
      this.markActivity('animation');
    } else {
      this.transition('stabilizing', 'animation-ended');
    }
  }

  beginFrame() {
    return this.activitySerial;
  }

  getStaticSampleCount() {
    return this.state === 'accumulating' ? this.accumulationFrame + 1 : 1;
  }

  completeFrame(frameActivitySerial: number, hasStaticAccumulator: boolean) {
    if (this.animationActive || this.interactionActive || frameActivitySerial !== this.activitySerial) {
      return;
    }

    if (this.state === 'interactive') {
      this.transition('stabilizing', 'interaction-ended');
      return;
    }

    if (this.state === 'stabilizing') {
      this.stabilizationFrame += 1;
      if (this.stabilizationFrame >= this.stabilizationFrames) {
        this.transition(
          hasStaticAccumulator ? 'accumulating' : 'sleeping',
          hasStaticAccumulator ? 'history-ready' : 'converged-without-static-mean',
        );
      }
      return;
    }

    if (this.state === 'accumulating') {
      this.accumulationFrame += 1;
      if (this.accumulationFrame >= this.accumulationFrames) {
        this.transition('sleeping', 'converged');
      }
    }
  }

  sleep(reason = 'suspended') {
    this.transition('sleeping', reason);
  }

  getState() {
    return this.state;
  }

  snapshot(pendingAnimationFrame: boolean): ViewerActivitySnapshot {
    return {
      state: this.state,
      reason: this.reason,
      stabilizationFrame: this.stabilizationFrame,
      stabilizationFrames: this.stabilizationFrames,
      accumulationFrame: this.accumulationFrame,
      accumulationFrames: this.accumulationFrames,
      staticSampleCount:
        this.state === 'accumulating'
          ? Math.min(this.accumulationFrame + 1, this.accumulationFrames)
          : this.state === 'sleeping' && this.reason === 'converged'
            ? this.accumulationFrames
            : 1,
      pendingAnimationFrame,
      interactionActive: this.interactionActive,
      animationActive: this.animationActive,
    };
  }

  private transition(state: RenderActivityState, reason: string) {
    this.state = state;
    this.reason = reason;

    if (state === 'interactive') {
      this.stabilizationFrame = 0;
      this.accumulationFrame = 0;
    } else if (state === 'stabilizing') {
      this.stabilizationFrame = 0;
      this.accumulationFrame = 0;
    } else if (state === 'accumulating') {
      this.accumulationFrame = 0;
    }
  }
}
