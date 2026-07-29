import 'three/webgpu';

declare module 'three/webgpu' {
  interface TempNode {
    updateBeforeType: string;
  }
}
