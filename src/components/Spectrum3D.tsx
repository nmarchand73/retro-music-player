import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { MiniSpectrum } from './MiniSpectrum';

const BAR_COUNT = 48;
const PEAK_HOLD_FRAMES = 20;
const PEAK_FALL = 0.013;
const FLOOR = 0.04;
const ATTACK = 0.9;
const RELEASE = 0.24;
const MAX_HEIGHT = 2.35;
const FRAME_PAD = 1.28;

interface Spectrum3DProps {
  analyser: AnalyserNode | null;
  playing: boolean;
  variant?: 'panel' | 'backdrop';
}

function groupBins(data: Uint8Array, groups: number): Float32Array {
  const out = new Float32Array(groups);
  const lo = 2;
  const hi = Math.max(lo + 1, Math.floor(data.length * 0.72));
  const span = hi / lo;

  for (let i = 0; i < groups; i += 1) {
    const start = Math.min(hi - 1, Math.floor(lo * Math.pow(span, i / groups)));
    const end = Math.min(hi, Math.max(start + 1, Math.floor(lo * Math.pow(span, (i + 1) / groups))));
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      const v = data[j] ?? 0;
      if (v > peak) peak = v;
    }
    out[i] = Math.pow(peak / 255, 1.1);
  }
  return out;
}

function mixBarColor(t: number, energy: number, out: THREE.Color) {
  out.set('#e2185a');
  out.lerp(new THREE.Color('#6b3fbf'), t);
  out.offsetHSL(0, 0.04 * energy, 0.1 * energy);
}

function createBackdropTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#fff8f0');
    gradient.addColorStop(0.45, '#f3d6e4');
    gradient.addColorStop(1, '#e5d0f2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 8, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Keep the full bar row + peaks inside the frustum for any aspect ratio. */
function frameCamera(
  camera: THREE.PerspectiveCamera,
  aspect: number,
  halfWidth: number,
  contentHeight: number,
) {
  camera.aspect = Math.max(0.2, aspect);
  camera.updateProjectionMatrix();

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const targetY = contentHeight * 0.32;
  const distW = (halfWidth * FRAME_PAD) / Math.tan(hFov / 2);
  const distH = (contentHeight * FRAME_PAD * 0.72) / Math.tan(vFov / 2);
  const dist = Math.max(distW, distH, 3.2);

  const baseX = 0;
  const baseY = targetY + dist * 0.22;
  const baseZ = dist * 0.9;
  camera.position.set(baseX, baseY, baseZ);
  camera.lookAt(0, targetY, 0);
  return { baseX, baseY, baseZ, targetY };
}

export function Spectrum3D({ analyser, playing, variant = 'panel' }: Spectrum3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const analyserRef = useRef(analyser);
  const playingRef = useRef(playing);
  const [fallback, setFallback] = useState(false);
  const isBackdrop = variant === 'backdrop';

  analyserRef.current = analyser;
  playingRef.current = playing;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || fallback) return;

    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let mirror: Reflector | undefined;
    let backdropTexture: THREE.CanvasTexture | undefined;

    const fail = (reason: unknown) => {
      console.error('[Spectrum3D]', reason);
      if (!disposed) setFallback(true);
    };

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      fail(error);
      return;
    }

    try {
      const scene = new THREE.Scene();
      if (isBackdrop) {
        scene.background = new THREE.Color(0xf6ebdf);
        renderer.setClearColor(0xf6ebdf, 1);
      } else {
        scene.background = new THREE.Color(0xf6ebdf);
      }
      scene.fog = new THREE.Fog(0xf6ebdf, 10, 22);

      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      host.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xfff1e4, 0.75));
      scene.add(new THREE.HemisphereLight(0xffe8f2, 0xe8d7c4, 0.9));

      const key = new THREE.PointLight(0xff3d7a, 40, 24, 2);
      key.position.set(-2.8, 3.6, 3.8);
      scene.add(key);

      const fill = new THREE.PointLight(0x8a5cff, 26, 20, 2);
      fill.position.set(3.2, 2.8, 2.4);
      scene.add(fill);

      const rim = new THREE.DirectionalLight(0xfff8ee, 1.05);
      rim.position.set(1.4, 5, -4);
      scene.add(rim);

      const floorGlow = new THREE.PointLight(0xe2185a, 14, 12, 2);
      floorGlow.position.set(0, 0.35, 1.1);
      scene.add(floorGlow);

      backdropTexture = createBackdropTexture();
      const backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(22, 12),
        new THREE.MeshBasicMaterial({ map: backdropTexture }),
      );
      backdrop.position.set(0, 2.8, -4.2);
      scene.add(backdrop);

      const spacing = 0.195;
      const radius = 0.072;
      const totalWidth = (BAR_COUNT - 1) * spacing;
      const halfWidth = totalWidth / 2;
      const contentHeight = MAX_HEIGHT + 0.35;
      let camFrame = frameCamera(camera, 1.6, halfWidth, contentHeight);

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      mirror = new Reflector(new THREE.PlaneGeometry(20, 10), {
        clipBias: 0.003,
        textureWidth: Math.max(512, Math.floor(host.clientWidth * pixelRatio) || 1024),
        textureHeight: Math.max(256, Math.floor(host.clientHeight * pixelRatio) || 512),
        color: 0xfff3ea,
      });
      mirror.rotation.x = -Math.PI / 2;
      mirror.position.y = 0;
      scene.add(mirror);

      const sheen = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 10),
        new THREE.MeshPhysicalMaterial({
          color: 0xfff8f0,
          transparent: true,
          opacity: 0.18,
          roughness: 0.18,
          metalness: 0.04,
          clearcoat: 1,
          clearcoatRoughness: 0.15,
        }),
      );
      sheen.rotation.x = -Math.PI / 2;
      sheen.position.y = 0.004;
      scene.add(sheen);

      const dummy = new THREE.Object3D();
      const color = new THREE.Color();

      const barGeo = new THREE.CylinderGeometry(radius, radius * 0.92, 1, 16);
      barGeo.translate(0, 0.5, 0);
      const barMat = new THREE.MeshStandardMaterial({
        roughness: 0.22,
        metalness: 0.42,
        emissive: new THREE.Color(0xe2185a),
        emissiveIntensity: 0.4,
      });
      const bars = new THREE.InstancedMesh(barGeo, barMat, BAR_COUNT);
      bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(bars);

      const mirrorBars = new THREE.InstancedMesh(
        barGeo,
        new THREE.MeshStandardMaterial({
          roughness: 0.35,
          metalness: 0.25,
          transparent: true,
          opacity: 0.32,
          emissive: new THREE.Color(0xe2185a),
          emissiveIntensity: 0.2,
        }),
        BAR_COUNT,
      );
      mirrorBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mirrorBars.scale.y = -1;
      scene.add(mirrorBars);

      const peakGeo = new THREE.SphereGeometry(radius * 0.88, 12, 10);
      const peakMat = new THREE.MeshStandardMaterial({
        color: 0xfff8ee,
        emissive: new THREE.Color(0xffd0e4),
        emissiveIntensity: 0.95,
        roughness: 0.28,
        metalness: 0.12,
      });
      const peaksMesh = new THREE.InstancedMesh(peakGeo, peakMat, BAR_COUNT);
      peaksMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(peaksMesh);

      for (let i = 0; i < BAR_COUNT; i += 1) {
        const x = i * spacing - halfWidth;
        mixBarColor(i / Math.max(1, BAR_COUNT - 1), 0.2, color);
        bars.setColorAt(i, color);
        mirrorBars.setColorAt(i, color);
        dummy.position.set(x, 0, 0);
        dummy.scale.set(1, FLOOR, 1);
        dummy.updateMatrix();
        bars.setMatrixAt(i, dummy.matrix);
        mirrorBars.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, FLOOR * MAX_HEIGHT + 0.08, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        peaksMesh.setMatrixAt(i, dummy.matrix);
      }
      if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
      if (mirrorBars.instanceColor) mirrorBars.instanceColor.needsUpdate = true;
      bars.instanceMatrix.needsUpdate = true;
      mirrorBars.instanceMatrix.needsUpdate = true;
      peaksMesh.instanceMatrix.needsUpdate = true;

      const display = new Float32Array(BAR_COUNT);
      const peaks = new Float32Array(BAR_COUNT);
      const holds = new Int16Array(BAR_COUNT);
      display.fill(FLOOR);
      peaks.fill(FLOOR);

      let freqBuffer: Uint8Array | null = null;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const timer = new THREE.Timer();
      timer.connect(document);

      const resize = () => {
        if (!renderer || disposed) return;
        const rect = host.getBoundingClientRect();
        const w = Math.max(2, Math.floor(rect.width));
        const h = Math.max(2, Math.floor(rect.height));
        camFrame = frameCamera(camera, w / h, halfWidth, contentHeight);
        renderer.setSize(w, h, false);
        const pr = Math.min(window.devicePixelRatio || 1, 2);
        mirror?.getRenderTarget().setSize(Math.floor(w * pr), Math.floor(h * pr));
      };

      resize();
      const observer = new ResizeObserver(() => resize());
      observer.observe(host);
      requestAnimationFrame(resize);

      const renderLoop = () => {
        if (disposed || !renderer) return;
        frame = requestAnimationFrame(renderLoop);

        try {
          timer.update();
          const t = timer.getElapsed();
          const currentAnalyser = analyserRef.current;
          const isPlaying = playingRef.current;

          if (currentAnalyser) {
            if (!freqBuffer || freqBuffer.length !== currentAnalyser.frequencyBinCount) {
              freqBuffer = new Uint8Array(currentAnalyser.frequencyBinCount);
            }
            currentAnalyser.smoothingTimeConstant = Math.min(currentAnalyser.smoothingTimeConstant, 0.22);
            currentAnalyser.minDecibels = -92;
            currentAnalyser.maxDecibels = -18;
            currentAnalyser.getByteFrequencyData(freqBuffer);
          }

          const levels = freqBuffer && currentAnalyser ? groupBins(freqBuffer, BAR_COUNT) : null;
          let energySum = 0;

          for (let i = 0; i < BAR_COUNT; i += 1) {
            const raw = levels ? levels[i]! : FLOOR + ((i * 17) % 7) * 0.004;
            const target =
              isPlaying && levels ? Math.min(1, raw * 1.45) : raw * (isPlaying ? 0.12 : 0.1);
            const prev = display[i]!;
            display[i] =
              target > prev ? prev + (target - prev) * ATTACK : prev + (target - prev) * RELEASE;
            display[i] = Math.max(FLOOR, display[i]!);

            const boosted = display[i]!;
            energySum += boosted;
            if (boosted >= peaks[i]!) {
              peaks[i] = boosted;
              holds[i] = PEAK_HOLD_FRAMES;
            } else if (holds[i]! > 0) {
              holds[i]!--;
            } else {
              peaks[i] = Math.max(FLOOR, peaks[i]! - PEAK_FALL);
            }

            const x = i * spacing - halfWidth;
            const h = Math.max(FLOOR, boosted) * MAX_HEIGHT;
            dummy.position.set(x, 0, 0);
            dummy.scale.set(1, h, 1);
            dummy.updateMatrix();
            bars.setMatrixAt(i, dummy.matrix);
            mirrorBars.setMatrixAt(i, dummy.matrix);

            mixBarColor(i / Math.max(1, BAR_COUNT - 1), boosted, color);
            bars.setColorAt(i, color);
            mirrorBars.setColorAt(i, color);

            dummy.position.set(x, peaks[i]! * MAX_HEIGHT + radius * 0.95, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            peaksMesh.setMatrixAt(i, dummy.matrix);
          }

          bars.instanceMatrix.needsUpdate = true;
          mirrorBars.instanceMatrix.needsUpdate = true;
          peaksMesh.instanceMatrix.needsUpdate = true;
          if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
          if (mirrorBars.instanceColor) mirrorBars.instanceColor.needsUpdate = true;

          const avgEnergy = energySum / BAR_COUNT;
          barMat.emissiveIntensity = 0.3 + avgEnergy * 0.7;
          floorGlow.intensity = 10 + avgEnergy * 20;

          if (!reduceMotion) {
            // Gentle left/right balance — orbit + slight roll, stronger while playing.
            const amp = isPlaying ? 1 : 0.35;
            const yaw = Math.sin(t * 0.38) * 0.11 * amp;
            const bob = Math.sin(t * 0.27) * 0.04 * amp;
            const breathe = Math.cos(t * 0.21) * 0.05 * amp;
            const radius = Math.hypot(camFrame.baseX, camFrame.baseZ) || camFrame.baseZ;
            camera.position.x = Math.sin(yaw) * radius;
            camera.position.y = camFrame.baseY + bob;
            camera.position.z = Math.cos(yaw) * radius + breathe;
            camera.lookAt(0, camFrame.targetY, 0);
            camera.rotation.z = -yaw * 0.22;
            key.intensity = 34 + (isPlaying ? Math.sin(t * 3.2) * 7 : 0) + avgEnergy * 12;
          } else {
            camera.position.set(camFrame.baseX, camFrame.baseY, camFrame.baseZ);
            camera.lookAt(0, camFrame.targetY, 0);
            camera.rotation.z = 0;
          }

          renderer.render(scene, camera);
        } catch (error) {
          cancelAnimationFrame(frame);
          fail(error);
        }
      };

      renderLoop();

      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        barGeo.dispose();
        barMat.dispose();
        (mirrorBars.material as THREE.Material).dispose();
        peakGeo.dispose();
        peakMat.dispose();
        backdrop.geometry.dispose();
        (backdrop.material as THREE.Material).dispose();
        backdropTexture?.dispose();
        sheen.geometry.dispose();
        (sheen.material as THREE.Material).dispose();
        mirror?.geometry.dispose();
        mirror?.dispose();
        timer.dispose();
        renderer?.dispose();
        if (renderer?.domElement.parentElement === host) {
          host.removeChild(renderer.domElement);
        }
      };
    } catch (error) {
      renderer?.dispose();
      if (renderer?.domElement.parentElement === host) {
        host.removeChild(renderer.domElement);
      }
      fail(error);
      return;
    }
  }, [fallback, isBackdrop]);

  if (fallback) {
    return (
      <div className={`spectrum-3d-fallback${isBackdrop ? ' is-backdrop' : ''}`}>
        <MiniSpectrum analyser={analyser} playing={playing} variant="stage" />
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className={`spectrum-3d${isBackdrop ? ' is-backdrop' : ''}`}
      aria-hidden="true"
    />
  );
}
