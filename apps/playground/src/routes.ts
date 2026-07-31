import type { DebugView, EffectName, QualityPresetName } from '@kyxos/viewer';

export interface DemoRoute {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  quality: QualityPresetName;
  focus?: EffectName;
  debugView?: DebugView;
  animate?: boolean;
}

export const demoRoutes: DemoRoute[] = [
  {
    slug: 'overview',
    title: 'Unified Realism Stack',
    eyebrow: 'Kyxos Render Engine',
    description: 'One WebGPU/TSL viewer, one Scene MRT and one composable RenderPipeline.',
    quality: 'medium',
  },
  {
    slug: 'pbr',
    title: 'PBR Material Preview',
    eyebrow: 'Material Study',
    description: 'Physical materials, image-based lighting, GLTF loading and Texture Lab map inputs.',
    quality: 'medium',
  },
  {
    slug: 'sss',
    title: 'Screen-Space Subsurface Scattering',
    eyebrow: 'Stochastic Temporal SSS',
    description:
      'Low-resolution 2/4/6-tap stochastic diffusion reconstructed with motion-vector temporal filtering and edge-aware history rejection.',
    quality: 'low',
  },
  {
    slug: 'buffers',
    title: 'Scene MRT Buffers',
    eyebrow: 'Debug Views',
    description:
      'Beauty, depth, velocity, normal, diffuse, metalness, roughness and emissive from one official pass().',
    quality: 'low',
    debugView: 'normal',
  },
  {
    slug: 'aa',
    title: 'Anti-Aliasing Lab',
    eyebrow: 'Exclusive AA Modes',
    description: 'Compare FXAA, SMAA, TRAA and capture SSAA without stacking incompatible AA methods.',
    quality: 'low',
    focus: 'fxaa',
  },
  {
    slug: 'traa',
    title: 'Temporal Reprojection AA',
    eyebrow: 'Official TRAANode',
    description: 'Beauty, depth, velocity and camera feed the official TRAA resolve with MSAA disabled.',
    quality: 'medium',
    focus: 'traa',
    animate: false,
  },
  {
    slug: 'temporal',
    title: 'Temporal Reprojection',
    eyebrow: 'History Reset',
    description:
      'Stochastic SSR is reprojected through an internal history buffer, with reset behavior for cuts, resize and asset changes.',
    quality: 'high',
    focus: 'temporalReprojection',
    animate: true,
  },
  {
    slug: 'gtao',
    title: 'Ground-Truth Ambient Occlusion',
    eyebrow: 'Official GTAONode',
    description: 'Half-resolution GTAO with tunable radius, samples, intensity and temporal smoothing.',
    quality: 'medium',
    focus: 'gtao',
  },
  {
    slug: 'ssao',
    title: 'Screen-Space Ambient Occlusion',
    eyebrow: 'Official SSAONode',
    description: 'A direct SSAO comparison path with adjustable resolution, radius and sample count.',
    quality: 'low',
    focus: 'ssao',
  },
  {
    slug: 'ssr',
    title: 'Screen-Space Reflections',
    eyebrow: 'Official SSRNode',
    description: 'Stochastic SSR using packed metalness/roughness buffers and environment fallback.',
    quality: 'medium',
    focus: 'ssr',
  },
  {
    slug: 'ssgi',
    title: 'Screen-Space Global Illumination',
    eyebrow: 'Official SSGINode',
    description: 'Diffuse GI and AO composition with official TRAA reused for temporal filtering.',
    quality: 'high',
    focus: 'ssgi',
  },
  {
    slug: 'motion-blur',
    title: 'Velocity Motion Blur',
    eyebrow: 'Official Motion Blur TSL',
    description: 'Camera and object velocity drive the official TSL motion blur implementation.',
    quality: 'cinematic',
    focus: 'motionBlur',
    animate: true,
  },
  {
    slug: 'denoise',
    title: 'Spatial + Temporal Denoise',
    eyebrow: 'Official Denoise Nodes',
    description:
      'Official recurrent denoising feeds filtered stochastic SSR back into temporal reprojection; Poisson remains an independent spatial filter.',
    quality: 'high',
    focus: 'temporalDenoise',
    animate: true,
  },
  {
    slug: 'sharpness',
    title: 'Post Sharpness',
    eyebrow: 'Official SharpenNode',
    description: 'A compact final-stage sharpness control after tone mapping and color grading.',
    quality: 'high',
    focus: 'sharpness',
  },
  {
    slug: 'lens-distortion',
    title: 'Lens Distortion',
    eyebrow: 'Small Kyxos TSL Node',
    description: 'A deliberately small radial distortion node fills one of the gaps in the official stack.',
    quality: 'cinematic',
    focus: 'lensDistortion',
  },
  {
    slug: 'background',
    title: 'Gradual Background',
    eyebrow: 'Scene Background TSL',
    description:
      'A TSL gradient is assigned directly to Scene.backgroundNode while environment lighting remains HDR.',
    quality: 'medium',
    focus: 'gradualBackground',
  },
  {
    slug: 'sparkle',
    title: 'Material Sparkle',
    eyebrow: 'Small Kyxos TSL Node',
    description: 'A restrained highlight sparkle layer designed for polished material presentation.',
    quality: 'cinematic',
    focus: 'sparkle',
  },
  {
    slug: 'full-stack',
    title: 'Complete Cinematic Stack',
    eyebrow: 'All Effects',
    description: 'GTAO, SSR, SSGI, temporal filtering, motion blur, bloom, DoF, LUT and lens treatment.',
    quality: 'cinematic',
    animate: true,
  },
  {
    slug: 'performance',
    title: 'Performance Telemetry',
    eyebrow: 'Renderer Metrics',
    description:
      'FPS, CPU/GPU timing, draw calls, triangles, textures, render targets and tracked GPU bytes.',
    quality: 'medium',
  },
  {
    slug: 'lifecycle',
    title: 'Lifecycle Acceptance',
    eyebrow: 'Resource Stability',
    description: 'Run resize, effect toggle, model/environment switching and viewer recreate stress checks.',
    quality: 'low',
  },
];

export function resolveRoute(pathname: string): DemoRoute {
  const parts = pathname.split('/').filter(Boolean);
  const latestIndex = parts.lastIndexOf('latest');
  const slug = latestIndex >= 0 ? parts[latestIndex + 1] : parts.at(-1);
  return demoRoutes.find((route) => route.slug === slug) ?? demoRoutes[0];
}
