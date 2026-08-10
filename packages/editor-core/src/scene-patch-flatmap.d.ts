import type { SceneNode, ScenePatch } from '@kyxos/scene-contract';

export {};

/**
 * TypeScript 5.9 can lock Array#flatMap inference to the first JSON Patch
 * operation returned by a callback. Scene-system mutations intentionally mix
 * remove, add and replace operations, all of which are valid ScenePatch items.
 * This narrow overload supplies the correct contextual return type only for
 * SceneNode patch builders; unrelated Array#flatMap calls keep the standard
 * library overloads.
 */
declare global {
  interface Array<T> {
    flatMap(
      this: SceneNode[],
      callbackfn: (
        this: undefined,
        value: SceneNode,
        index: number,
        array: SceneNode[],
      ) => ScenePatch,
      thisArg?: undefined,
    ): ScenePatch;
  }
}
