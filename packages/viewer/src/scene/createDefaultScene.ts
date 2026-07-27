import {
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  TorusKnotGeometry,
} from 'three/webgpu';

export interface DefaultSceneBundle {
  scene: Scene;
  camera: PerspectiveCamera;
  modelRoot: Group;
  animatedRoot: Group;
  animate: (elapsed: number, delta: number) => void;
}

export function createDefaultScene(): DefaultSceneBundle {
  const scene = new Scene();
  scene.name = 'Kyxos.Scene';

  const camera = new PerspectiveCamera(45, 1, 0.05, 100);
  camera.position.set(4.8, 3.2, 6.6);
  camera.lookAt(0, 0.75, 0);

  const modelRoot = new Group();
  modelRoot.name = 'Kyxos.ModelRoot';
  scene.add(modelRoot);

  const animatedRoot = new Group();
  animatedRoot.name = 'Kyxos.AnimatedRoot';
  modelRoot.add(animatedRoot);

  const heroMaterial = new MeshPhysicalMaterial({
    color: new Color('#cbd5e1'),
    metalness: 0.72,
    roughness: 0.23,
    clearcoat: 0.55,
    clearcoatRoughness: 0.16,
  });
  const hero = new Mesh(new TorusKnotGeometry(0.92, 0.31, 192, 48), heroMaterial);
  hero.position.set(0, 1.25, 0);
  hero.castShadow = true;
  hero.receiveShadow = true;
  animatedRoot.add(hero);

  const matte = new MeshStandardMaterial({ color: '#d7c7b3', metalness: 0.05, roughness: 0.82 });
  const sphere = new Mesh(new SphereGeometry(0.58, 64, 32), matte);
  sphere.position.set(-1.75, 0.62, 0.35);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  modelRoot.add(sphere);

  const coated = new MeshPhysicalMaterial({
    color: '#6ee7b7',
    metalness: 0.15,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const box = new Mesh(new BoxGeometry(0.95, 0.95, 0.95, 8, 8, 8), coated);
  box.position.set(1.65, 0.58, 0.3);
  box.rotation.set(0.18, 0.42, 0.08);
  box.castShadow = true;
  box.receiveShadow = true;
  modelRoot.add(box);

  const floorMaterial = new MeshPhysicalMaterial({
    color: '#20262f',
    metalness: 0.15,
    roughness: 0.32,
    clearcoat: 0.6,
    clearcoatRoughness: 0.28,
  });
  const floor = new Mesh(new PlaneGeometry(18, 18, 1, 1), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new GridHelper(18, 36, 0x475569, 0x273244);
  grid.position.y = 0.002;
  scene.add(grid);

  const hemi = new HemisphereLight(0xdbeafe, 0x111827, 1.35);
  scene.add(hemi);

  const key = new DirectionalLight(0xfff2df, 5.5);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 30;
  scene.add(key);

  const rim = new DirectionalLight(0x93c5fd, 3.2);
  rim.position.set(-5, 3, -4);
  scene.add(rim);

  const animate = (elapsed: number, delta: number) => {
    animatedRoot.rotation.y += delta * 0.35;
    hero.rotation.x += delta * 0.08;
    hero.rotation.z += delta * 0.05;
    animatedRoot.position.y = Math.sin(elapsed * 0.9) * 0.055;
    box.rotation.y -= delta * 0.18;
  };

  return { scene, camera, modelRoot, animatedRoot, animate };
}
