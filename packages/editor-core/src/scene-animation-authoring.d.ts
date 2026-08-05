import '@kyxos/scene-contract';

declare module '@kyxos/scene-contract' {
  interface SceneAnimation {
    /**
     * Optional imported glTF channel metadata used by authoring pickers and
     * diagnostics. Runtime playback continues to resolve the immutable clip by
     * clipIndex, so projects created before channel metadata remain compatible.
     */
    channels?: Array<{
      targetNodeId?: string;
      path: string;
      interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
    }>;
  }
}
