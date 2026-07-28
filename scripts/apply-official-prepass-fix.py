from pathlib import Path

viewer_path = Path('packages/viewer/src/KyxosViewer.ts')
text = viewer_path.read_text()

old_import = """import {
  diffuseColor,
  emissive,
  materialMetalness,
  materialRoughness,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  sample,
  screenUV,
  texture3D,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
"""
new_import = """import {
  diffuseColor,
  metalness,
  mrt,
  normalView,
  packNormalToRGB,
  pass,
  renderOutput,
  roughness,
  sample,
  screenUV,
  texture3D,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
"""
if old_import not in text:
    raise SystemExit('TSL import block did not match')
text = text.replace(old_import, new_import, 1)

start = text.index("    const scenePass = pass(this.scene, this.camera);\n")
end = text.index("    let source: any = beauty;\n", start)
new_passes = """    // Keep the lit beauty pass independent from material-data MRT. This mirrors
    // the official Three.js AO pre-pass architecture and prevents one unsupported
    // material attachment from invalidating the visible scene color.
    const prePass = pass(this.scene, this.camera);
    prePass.name = 'Kyxos.PrePassMRT';
    prePass.transparent = false;
    prePass.options.samples = 0;
    prePass.setMRT(
      mrt({
        output: packNormalToRGB(normalView),
        velocity,
        metalrough: vec2(metalness, roughness),
        diffuseColor: vec4(diffuseColor.rgb, 1),
      }),
    );
    this.nodes.push(prePass);

    const depth = prePass.getTextureNode('depth');
    const linearDepth = prePass.getLinearDepthNode();
    const normalPacked = prePass.getTextureNode('output');
    const velocityNode = prePass.getTextureNode('velocity');
    const metalRough = prePass.getTextureNode('metalrough');
    const diffuseMetal = prePass.getTextureNode('diffuseColor');

    const normalTexture = prePass.getTexture('output');
    normalTexture.type = THREE.UnsignedByteType;
    const metalRoughTexture = prePass.getTexture('metalrough');
    metalRoughTexture.type = THREE.UnsignedByteType;
    const diffuseTexture = prePass.getTexture('diffuseColor');
    diffuseTexture.type = THREE.UnsignedByteType;

    const sceneNormal = sample((uv: any) => unpackRGBToNormal(normalPacked.sample(uv).rgb));
    const metalRoughness = sample((uv: any) => metalRough.sample(uv).rg);

    const scenePass = pass(this.scene, this.camera);
    scenePass.name = 'Kyxos.Beauty';
    scenePass.options.samples = 0;
    this.nodes.push(scenePass);

    const beauty = scenePass.getTextureNode('output');
    const viewZ = scenePass.getViewZNode();

    this.debugNodes.set('beauty', renderOutput(beauty));
    this.debugNodes.set('depth', vec4(vec3(linearDepth), 1));
    this.debugNodes.set('velocity', vec4(velocityNode.xy.mul(8).add(0.5), 0, 1));
    this.debugNodes.set('normal', vec4(normalPacked.rgb, 1));
    this.debugNodes.set('diffuseColor', vec4(diffuseMetal.rgb, 1));
    this.debugNodes.set('metalness', vec4(vec3(metalRough.r), 1));
    this.debugNodes.set('roughness', vec4(vec3(metalRough.g), 1));
    this.debugNodes.set('emissive', vec4(0, 0, 0, 1));
    this.warn(
      'emissive-prepass',
      'Emissive debug output is isolated from the core pre-pass while the visible pipeline is stabilized.',
    );

"""
text = text[:start] + new_passes + text[end:]

replacements = [
    ("            diffuseNode: diffuseMetal,\n", "            diffuseNode: diffuseMetal,\n"),
    ("            metalnessNode: diffuseMetal.a,\n", "            metalnessNode: metalRough.r,\n"),
    ("            roughnessNode: normalPacked.a,\n", "            roughnessNode: metalRough.g,\n"),
    ("            environmentNode: this.scene.environment ?? null,\n", ""),
    ("          if (this.scene.environment) ssrNode.setEnvMap(this.scene.environment);\n", ""),
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Replacement did not match: {old!r}')
    text = text.replace(old, new, 1)

viewer_path.write_text(text)

scene_path = Path('packages/viewer/src/scene/createDefaultScene.ts')
scene = scene_path.read_text()
scene = scene.replace('  GridHelper,\n', '')
grid_block = """  const grid = new GridHelper(18, 36, 0x475569, 0x273244);
  grid.position.y = 0.002;
  scene.add(grid);

"""
if grid_block not in scene:
    raise SystemExit('GridHelper block did not match')
scene = scene.replace(grid_block, '', 1)
scene_path.write_text(scene)

# Strengthen the existing browser gate: the raw Beauty output must also contain
# visible pixels, not only the final post-processed output.
test_path = Path('tests/e2e/playground.spec.ts')
tests = test_path.read_text()
needle = """  expect(pixels.visible).toBeGreaterThan(pixels.total * 0.1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => message.includes('colorNode.sample'))).toEqual([]);
});
"""
replacement = """  expect(pixels.visible).toBeGreaterThan(pixels.total * 0.1);

  await page.evaluate(() => window.__kyxosTestApi.setDebugView('beauty'));
  await page.waitForTimeout(250);
  const beautyPixels = await page.evaluate(() => {
    const source = document.querySelector<HTMLCanvasElement>('#viewport');
    if (!source) throw new Error('Viewport canvas not found.');
    const copy = document.createElement('canvas');
    copy.width = 96;
    copy.height = 64;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D verification context unavailable.');
    context.drawImage(source, 0, 0, copy.width, copy.height);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    let visible = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] + data[index + 1] + data[index + 2] > 24 && data[index + 3] > 0) visible += 1;
    }
    return { visible, total: copy.width * copy.height };
  });
  expect(beautyPixels.visible).toBeGreaterThan(beautyPixels.total * 0.1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => message.includes('colorNode.sample'))).toEqual([]);
});
"""
if needle not in tests:
    raise SystemExit('Pixel acceptance block did not match')
tests = tests.replace(needle, replacement, 1)
test_path.write_text(tests)
