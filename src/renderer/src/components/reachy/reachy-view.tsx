/**
 * The Reachy Mini drawn where the Live2D avatar stands (Virgil, OLV7-32).
 *
 * The model is Pollen's own (reachy_mini, Apache-2.0): its URDF and STL parts
 * come from the robot's daemon, through this page's own server
 * (`/api/reachy/urdf`, `/api/reachy/stl/...`), and its pose from the daemon's
 * state stream (`/api/reachy/state-ws`), so the drawing moves when the robot
 * - or the simulator - does. The robot has no mouth: speech still shows in
 * the subtitles.
 */
import { memo, useEffect, useRef } from 'react';
import {
  AmbientLight, Color, DirectionalLight, HemisphereLight, LoadingManager, Mesh,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer, Material,
} from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import URDFLoader from 'urdf-loader';
import {
  applyState, parseState, prepareRig, ReachyRig, ReachyState, RobotLike,
} from './reachy-pose';

interface ReachyViewProps {
  /** The page's server, e.g. http://127.0.0.1:12393. */
  baseUrl: string;
}

function socketBase(baseUrl: string): string {
  return baseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
}

export const ReachyView = memo(({ baseUrl }: ReachyViewProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const base = baseUrl.replace(/\/$/, '');
    let disposed = false;

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(new Color(0x000000), 0);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.add(new HemisphereLight(0xffffff, 0x404050, 1.6));
    scene.add(new AmbientLight(0xffffff, 0.4));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const rim = new DirectionalLight(0xbfd4ff, 0.8);
    rim.position.set(-1.5, 1, -1);
    scene.add(rim);

    // The robot faces +x in its own frame; the scene is y-up.
    const camera = new PerspectiveCamera(28, 1, 0.01, 10);
    camera.position.set(1.12, 0.32, 0.24);
    const target = new Vector3(0, 0.14, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enablePan = false;
    controls.minDistance = 0.25;
    controls.maxDistance = 1.5;
    controls.update();

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // --- the model -----------------------------------------------------------
    let rig: ReachyRig | null = null;
    let latest: ReachyState | null = null;
    let fresh = false;
    const manager = new LoadingManager();
    const stl = new STLLoader(manager);
    const geometries = new Map<string, Promise<unknown>>();
    const loader = new URDFLoader(manager);
    loader.loadMeshCb = (path: string, _m: LoadingManager, material: Material, done) => {
      const name = path.split('/').pop() || '';
      let geometry = geometries.get(name);
      if (!geometry) {
        geometry = stl.loadAsync(`${base}/api/reachy/stl/${encodeURIComponent(name)}`);
        geometries.set(name, geometry);
      }
      geometry
        .then((g) => done(new Mesh(g as never, material)))
        .catch((err) => done(null as never, err));
    };

    fetch(`${base}/api/reachy/urdf`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`urdf ${r.status}`))))
      .then((data: { urdf?: string }) => {
        if (disposed || !data.urdf) return;
        const robot = loader.parse(data.urdf) as unknown as RobotLike;
        robot.rotation.x = -Math.PI / 2;
        scene.add(robot);
        robot.updateMatrixWorld(true);
        rig = prepareRig(robot);
        if (!rig) console.warn('Reachy view: this robot model is not the one expected');
        fresh = true;
      })
      .catch((err) => console.warn('Reachy view: the robot model could not be loaded', err));

    // --- the pose ------------------------------------------------------------
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const openState = () => {
      if (disposed) return;
      socket = new WebSocket(`${socketBase(base)}/api/reachy/state-ws`);
      socket.onmessage = (event) => {
        try {
          const state = parseState(JSON.parse(event.data));
          if (state) {
            latest = state;
            fresh = true;
          }
        } catch {
          // a frame that is not JSON is skipped
        }
      };
      socket.onclose = () => {
        socket = null;
        if (!disposed) retry = setTimeout(openState, 2000);
      };
    };
    openState();

    let frame = 0;
    const draw = () => {
      if (disposed) return;
      frame = requestAnimationFrame(draw);
      if (rig && latest && fresh) {
        const gap = applyState(rig, latest);
        (window as unknown as { reachyRodGap?: number }).reachyRodGap = gap;
      }
      fresh = false;
      controls.update();
      renderer.render(scene, camera);
    };
    draw();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (retry) clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const { material } = mesh;
          (Array.isArray(material) ? material : [material]).forEach((m) => m?.dispose());
        }
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [baseUrl]);

  return (
    <div
      ref={containerRef}
      id="reachy-view"
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden',
      }}
    />
  );
});

ReachyView.displayName = 'ReachyView';
