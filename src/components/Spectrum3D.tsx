import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { AmigaDemoScroll } from './AmigaDemoScroll';
import { createGreenBarFloorTexture, type GreenBarFloorHandle } from './GreenBarListing';
import { MiniSpectrum } from './MiniSpectrum';

const BAR_COUNT = 40;
const PEAK_HOLD_FRAMES = 18;
const PEAK_FALL = 0.014;
const FLOOR = 0.04;
const ATTACK = 0.9;
const RELEASE = 0.24;
const MAX_HEIGHT = 2.7;
const FRAME_PAD = 1.22;
const BAR_SPACING = 0.26;
const BAR_RADIUS = 0.098;
const MAX_PIXEL_RATIO = 1.15;
const IDLE_FPS = 20;

interface Spectrum3DProps {
  analyser: AnalyserNode | null;
  playing: boolean;
  variant?: 'panel' | 'backdrop';
  /** Optional Amiga-demo scrolltext (e.g. game history). */
  demoTitle?: string | null;
  demoText?: string | null;
  /** Per-track key for green-bar listing rotation. */
  trackKey?: string | null;
  listingTitle?: string | null;
  listingSubtitle?: string | null;
}

const levelsScratch = new Float32Array(BAR_COUNT);
const peakCream = new THREE.Color('#fff8ee');

/** Same stops as mini-player `useSpectrum` canvas gradient (bottom → top). */
const SPECTRUM_GRADIENT = [
  { stop: 0, color: new THREE.Color('#e2185a') },
  { stop: 0.45, color: new THREE.Color('#d43aa8') },
  { stop: 0.78, color: new THREE.Color('#7b4ec4') },
  { stop: 1, color: new THREE.Color('#3d2f8a') },
] as const;

function groupBinsInto(data: Uint8Array, groups: number, out: Float32Array): void {
  const lo = Math.max(5, Math.floor(data.length * 0.003));
  const hi = Math.max(lo + 1, data.length - 1);
  const span = hi / lo;

  for (let i = 0; i < groups; i += 1) {
    const t = i / Math.max(1, groups - 1);
    const start = Math.min(hi - 1, Math.floor(lo * Math.pow(span, i / groups)));
    const end = Math.min(hi, Math.max(start + 1, Math.floor(lo * Math.pow(span, (i + 1) / groups))));
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      const v = data[j] ?? 0;
      if (v > peak) peak = v;
    }
    const gate = 14 + (1 - t) * 16;
    if (peak < gate) {
      out[i] = 0;
      continue;
    }
    const shelf = 1 + t * 0.65;
    out[i] = Math.min(1, Math.pow((peak - gate * 0.35) / 255, 1.05) * shelf);
  }
}

function sampleSpectrumGradient(amount: number, out: THREE.Color): void {
  const t = Math.min(1, Math.max(0, amount));
  for (let i = 0; i < SPECTRUM_GRADIENT.length - 1; i += 1) {
    const a = SPECTRUM_GRADIENT[i]!;
    const b = SPECTRUM_GRADIENT[i + 1]!;
    if (t <= b.stop || i === SPECTRUM_GRADIENT.length - 2) {
      const span = Math.max(1e-6, b.stop - a.stop);
      const frac = (t - a.stop) / span;
      out.copy(a.color).lerp(b.color, Math.min(1, Math.max(0, frac)));
      return;
    }
  }
  out.copy(SPECTRUM_GRADIENT[SPECTRUM_GRADIENT.length - 1]!.color);
}

function mixTipColor(energy: number, out: THREE.Color) {
  // Cap color = tip of the bar on the same absolute height ramp as the mini spectrum.
  sampleSpectrumGradient(Math.min(1, Math.max(FLOOR, energy)), out);
  out.offsetHSL(0, 0.02 * energy, 0.08 + 0.1 * energy);
}

function mixPeakColor(energy: number, out: THREE.Color) {
  sampleSpectrumGradient(Math.min(1, Math.max(0.5, energy)), out);
  out.lerp(peakCream, 0.7 + 0.18 * energy);
}

/**
 * Vertical pink→purple ramp keyed to world Y / MAX_HEIGHT — same absolute mapping
 * as the mini-player canvas gradient (short bars stay pink; tall bars reach purple).
 */
function createSpectrumBarMaterial(opts: {
  metalness?: number;
  roughness?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: opts.roughness ?? 0.28,
    metalness: opts.metalness ?? 0.42,
    emissive: new THREE.Color('#e2185a'),
    emissiveIntensity: opts.emissiveIntensity ?? 0.42,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? !(opts.transparent ?? false),
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uC0 = { value: SPECTRUM_GRADIENT[0]!.color };
    shader.uniforms.uC1 = { value: SPECTRUM_GRADIENT[1]!.color };
    shader.uniforms.uC2 = { value: SPECTRUM_GRADIENT[2]!.color };
    shader.uniforms.uC3 = { value: SPECTRUM_GRADIENT[3]!.color };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying float vGradT;
varying float vSideShine;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  vGradT = clamp((instanceMatrix * vec4(transformed, 1.0)).y / ${MAX_HEIGHT.toFixed(3)}, 0.0, 1.0);
#else
  vGradT = clamp(transformed.y / ${MAX_HEIGHT.toFixed(3)}, 0.0, 1.0);
#endif
vSideShine = abs(normal.x) * 0.28;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying float vGradT;
varying float vSideShine;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
vec3 spectrumGrad(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.45) return mix(uC0, uC1, t / 0.45);
  if (t < 0.78) return mix(uC1, uC2, (t - 0.45) / 0.33);
  return mix(uC2, uC3, (t - 0.78) / 0.22);
}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec3 g = spectrumGrad(vGradT);
  diffuseColor.rgb = g + vec3(vSideShine);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance *= spectrumGrad(vGradT);`,
      );
  };

  mat.customProgramCacheKey = () => 'spectrum-bar-grad-v1';
  return mat;
}

function barDepth(t: number): number {
  return Math.sin(t * Math.PI) * 0.55;
}

function createBackdropTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, size);
    sky.addColorStop(0, '#2a1848');
    sky.addColorStop(0.28, '#6b3a6e');
    sky.addColorStop(0.55, '#c9789a');
    sky.addColorStop(0.78, '#f0c4b0');
    sky.addColorStop(1, '#f7e6d4');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, size, size);

    const bloom = ctx.createRadialGradient(size / 2, size * 0.4, 10, size / 2, size * 0.55, size * 0.65);
    bloom.addColorStop(0, 'rgba(255, 120, 170, 0.45)');
    bloom.addColorStop(0.45, 'rgba(140, 90, 220, 0.22)');
    bloom.addColorStop(1, 'rgba(40, 20, 70, 0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(255, 248, 240, 0.06)';
    ctx.lineWidth = 1;
    for (let y = 20; y < size; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    for (let x = 12; x < size; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

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
  const baseY = targetY + dist * 0.16;
  const baseZ = dist * 0.98;
  camera.position.set(baseX, baseY, baseZ);
  camera.lookAt(0, targetY * 0.85, 0.15);
  return { baseX, baseY, baseZ, targetY };
}

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const material = mesh.material;
    if (!material) return;
    for (const mat of Array.isArray(material) ? material : [material]) {
      materials.add(mat);
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map) textures.add(map);
    }
  });

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export function Spectrum3D({
  analyser,
  playing,
  variant = 'panel',
  demoTitle = null,
  demoText = null,
  trackKey = null,
  listingTitle = null,
  listingSubtitle = null,
}: Spectrum3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const analyserRef = useRef(analyser);
  const playingRef = useRef(playing);
  const demoTitleRef = useRef(demoTitle);
  const demoTextRef = useRef(demoText);
  const trackKeyRef = useRef(trackKey);
  const listingTitleRef = useRef(listingTitle);
  const listingSubtitleRef = useRef(listingSubtitle);
  const [fallback, setFallback] = useState(false);
  const isBackdrop = variant === 'backdrop';
  /** History scroll + bounce-ball overlay (all platforms). */
  const showAmigaDemo = Boolean(demoText && demoTitle);

  analyserRef.current = analyser;
  playingRef.current = playing;
  demoTitleRef.current = demoTitle;
  demoTextRef.current = demoText;
  trackKeyRef.current = trackKey;
  listingTitleRef.current = listingTitle;
  listingSubtitleRef.current = listingSubtitle;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || fallback) return;

    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let backdropTexture: THREE.CanvasTexture | undefined;
    let listingFloor: GreenBarFloorHandle | undefined;
    let lastTickMs = 0;
    let lastIdleFrameMs = 0;

    const fail = (reason: unknown) => {
      console.error('[Spectrum3D]', reason);
      if (!disposed) setFallback(true);
    };

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      });
    } catch (error) {
      fail(error);
      return;
    }

    try {
      const scene = new THREE.Scene();
      const clear = 0x1c1230;
      scene.background = new THREE.Color(clear);
      if (isBackdrop) renderer.setClearColor(clear, 1);
      scene.fog = new THREE.Fog(0x2a1848, 22, 42);

      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      host.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffe8f4, 0.55));
      scene.add(new THREE.HemisphereLight(0xffd8ec, 0x2a1848, 0.85));

      const key = new THREE.PointLight(0xff4d88, 42, 22, 1.8);
      key.position.set(-3.2, 4.2, 5.2);
      scene.add(key);

      const fill = new THREE.PointLight(0x9b6cff, 28, 20, 1.9);
      fill.position.set(3.6, 3.2, 3.2);
      scene.add(fill);

      backdropTexture = createBackdropTexture();
      const backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 17),
        new THREE.MeshBasicMaterial({ map: backdropTexture }),
      );
      backdrop.position.set(0, 3.4, -5.6);
      scene.add(backdrop);

      listingFloor = createGreenBarFloorTexture(1024, 512);
      const listingMat = new THREE.MeshBasicMaterial({
        map: listingFloor.texture,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
      });
      const listingPlane = new THREE.Mesh(new THREE.PlaneGeometry(18, 10), listingMat);
      listingPlane.rotation.x = -Math.PI / 2;
      listingPlane.position.y = 0.006;
      listingPlane.renderOrder = 1;
      scene.add(listingPlane);

      const spacing = BAR_SPACING;
      const radius = BAR_RADIUS;
      const totalWidth = (BAR_COUNT - 1) * spacing;
      const halfWidth = totalWidth / 2;
      const contentHeight = MAX_HEIGHT + 1.05;
      let camFrame = frameCamera(camera, 1.6, halfWidth, contentHeight);

      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      const peakColor = new THREE.Color();

      const barGeo = new THREE.CylinderGeometry(radius * 0.72, radius, 1, 8, 1, false);
      barGeo.translate(0, 0.5, 0);
      const barMat = createSpectrumBarMaterial({
        roughness: 0.28,
        metalness: 0.42,
        emissiveIntensity: 0.48,
      });
      const bars = new THREE.InstancedMesh(barGeo, barMat, BAR_COUNT);
      bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(bars);

      const capGeo = new THREE.SphereGeometry(radius * 0.78, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const capMat = new THREE.MeshStandardMaterial({
        roughness: 0.22,
        metalness: 0.55,
        emissive: new THREE.Color(0xd43aa8),
        emissiveIntensity: 0.32,
      });
      const caps = new THREE.InstancedMesh(capGeo, capMat, BAR_COUNT);
      caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(caps);

      const mirrorMat = createSpectrumBarMaterial({
        roughness: 1,
        metalness: 0,
        emissiveIntensity: 0.12,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      });
      const mirrorBars = new THREE.InstancedMesh(barGeo, mirrorMat, BAR_COUNT);
      mirrorBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mirrorBars.scale.y = -1;
      scene.add(mirrorBars);

      const peakGeo = new THREE.SphereGeometry(radius * 0.88, 6, 4);
      const peakMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.05,
        roughness: 0.35,
        metalness: 0.2,
      });
      const peaksMesh = new THREE.InstancedMesh(peakGeo, peakMat, BAR_COUNT);
      peaksMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      peaksMesh.renderOrder = 3;
      scene.add(peaksMesh);

      for (let i = 0; i < BAR_COUNT; i += 1) {
        const x = i * spacing - halfWidth;
        const band = i / Math.max(1, BAR_COUNT - 1);
        const z = barDepth(band);
        mixTipColor(0.2, color);
        mixPeakColor(0.35, peakColor);
        caps.setColorAt(i, color);
        peaksMesh.setColorAt(i, peakColor);
        dummy.position.set(x, 0, z);
        dummy.scale.set(1, FLOOR, 1);
        dummy.updateMatrix();
        bars.setMatrixAt(i, dummy.matrix);
        mirrorBars.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, FLOOR * MAX_HEIGHT, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        caps.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, FLOOR * MAX_HEIGHT + radius * 1.1, z);
        peaksMesh.setMatrixAt(i, dummy.matrix);
      }
      if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
      if (peaksMesh.instanceColor) peaksMesh.instanceColor.needsUpdate = true;
      bars.instanceMatrix.needsUpdate = true;
      caps.instanceMatrix.needsUpdate = true;
      mirrorBars.instanceMatrix.needsUpdate = true;
      peaksMesh.instanceMatrix.needsUpdate = true;

      const display = new Float32Array(BAR_COUNT);
      const peaks = new Float32Array(BAR_COUNT);
      const holds = new Int16Array(BAR_COUNT);
      display.fill(FLOOR);
      peaks.fill(FLOOR);

      let freqBuffer: Uint8Array<ArrayBuffer> | null = null;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const timer = new THREE.Timer();
      timer.connect(document);

      const resize = () => {
        if (!renderer || disposed) return;
        const rect = host.getBoundingClientRect();
        const w = Math.max(2, Math.floor(rect.width));
        const h = Math.max(2, Math.floor(rect.height));
        camFrame = frameCamera(camera, w / h, halfWidth, contentHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
        renderer.setSize(w, h, false);
      };

      resize();
      const observer = new ResizeObserver(() => resize());
      observer.observe(host);

      const onVisibility = () => {
        if (!document.hidden && !disposed) timer.update();
      };
      document.addEventListener('visibilitychange', onVisibility);

      const renderLoop = () => {
        if (disposed || !renderer) return;
        frame = requestAnimationFrame(renderLoop);

        if (document.hidden) return;

        const now = performance.now();
        const isPlaying = playingRef.current;
        if (!isPlaying) {
          const idleGap = 1000 / IDLE_FPS;
          if (lastIdleFrameMs && now - lastIdleFrameMs < idleGap) return;
          lastIdleFrameMs = now;
        }

        try {
          timer.update();
          const t = timer.getElapsed();
          const currentAnalyser = analyserRef.current;
          const tickDt = lastTickMs ? Math.min(0.05, (now - lastTickMs) / 1000) : 0.016;
          lastTickMs = now;

          if (listingFloor) {
            listingFloor.update({
              playing: isPlaying && !reduceMotion,
              dt: tickDt,
              trackKey: trackKeyRef.current,
              title: listingTitleRef.current,
              text: listingSubtitleRef.current,
            });
          }

          if (currentAnalyser) {
            if (!freqBuffer || freqBuffer.length !== currentAnalyser.frequencyBinCount) {
              freqBuffer = new Uint8Array(new ArrayBuffer(currentAnalyser.frequencyBinCount));
            }
            currentAnalyser.getByteFrequencyData(freqBuffer);
            groupBinsInto(freqBuffer, BAR_COUNT, levelsScratch);
          }

          const levels = freqBuffer && currentAnalyser ? levelsScratch : null;
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
            const z = barDepth(i / Math.max(1, BAR_COUNT - 1));
            const h = Math.max(FLOOR, boosted) * MAX_HEIGHT;
            const girth = 1 + boosted * 0.28;
            dummy.rotation.set(0, 0, 0);
            dummy.position.set(x, 0, z);
            dummy.scale.set(girth, h, girth);
            dummy.updateMatrix();
            bars.setMatrixAt(i, dummy.matrix);
            mirrorBars.setMatrixAt(i, dummy.matrix);

            mixTipColor(boosted, color);
            caps.setColorAt(i, color);

            dummy.position.set(x, h, z);
            dummy.scale.set(girth, girth, girth);
            dummy.updateMatrix();
            caps.setMatrixAt(i, dummy.matrix);

            mixPeakColor(boosted, peakColor);
            peaksMesh.setColorAt(i, peakColor);

            const peakScale = 0.9 + boosted * 0.55;
            dummy.position.set(x, peaks[i]! * MAX_HEIGHT + radius * 1.15 * peakScale, z);
            dummy.scale.set(peakScale, peakScale, peakScale);
            dummy.updateMatrix();
            peaksMesh.setMatrixAt(i, dummy.matrix);
          }

          bars.instanceMatrix.needsUpdate = true;
          caps.instanceMatrix.needsUpdate = true;
          mirrorBars.instanceMatrix.needsUpdate = true;
          peaksMesh.instanceMatrix.needsUpdate = true;
          if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
          if (peaksMesh.instanceColor) peaksMesh.instanceColor.needsUpdate = true;

          const avgEnergy = energySum / BAR_COUNT;
          barMat.emissiveIntensity = 0.38 + avgEnergy * 0.85;
          mirrorMat.emissiveIntensity = 0.1 + avgEnergy * 0.2;
          capMat.emissiveIntensity = 0.26 + avgEnergy * 0.6;
          peakMat.emissiveIntensity = 0.9 + avgEnergy * 0.75;
          renderer.toneMappingExposure = 1.06 + avgEnergy * 0.18;

          if (!reduceMotion) {
            const amp = isPlaying ? 1 : 0.35;
            const yaw = Math.sin(t * 0.38) * 0.1 * amp;
            const bob = Math.sin(t * 0.27) * 0.035 * amp;
            const breathe = Math.cos(t * 0.21) * 0.045 * amp;
            const orbitR = Math.hypot(camFrame.baseX, camFrame.baseZ) || camFrame.baseZ;
            camera.position.x = Math.sin(yaw) * orbitR;
            camera.position.y = camFrame.baseY + bob;
            camera.position.z = Math.cos(yaw) * orbitR + breathe;
            camera.lookAt(0, camFrame.targetY * 0.85, 0.15);
            camera.rotation.z = -yaw * 0.2;
            key.intensity = 36 + (isPlaying ? Math.sin(t * 3.2) * 6 : 0) + avgEnergy * 12;
          } else {
            camera.position.set(camFrame.baseX, camFrame.baseY, camFrame.baseZ);
            camera.lookAt(0, camFrame.targetY * 0.85, 0.15);
            camera.rotation.z = 0;
          }

          renderer.render(scene, camera);
        } catch (error) {
          cancelAnimationFrame(frame);
          fail(error);
        }
      };

      frame = requestAnimationFrame(renderLoop);

      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        timer.dispose();
        listingFloor?.dispose();
        listingFloor = undefined;
        disposeObject(scene);
        backdropTexture?.dispose();
        renderer?.dispose();
        renderer?.forceContextLoss();
        const gl = renderer?.getContext();
        const lose = gl?.getExtension('WEBGL_lose_context');
        lose?.loseContext();
        if (renderer?.domElement.parentElement === host) {
          host.removeChild(renderer.domElement);
        }
        renderer = undefined;
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

  const stage = fallback ? (
    <div className={`spectrum-3d-fallback${isBackdrop ? ' is-backdrop' : ''}`}>
      <MiniSpectrum analyser={analyser} playing={playing} variant="stage" />
    </div>
  ) : (
    <div
      ref={hostRef}
      className={`spectrum-3d${isBackdrop ? ' is-backdrop' : ''}`}
      aria-hidden="true"
    />
  );

  return (
    <div className={`spectrum-3d-shell${isBackdrop ? ' is-backdrop' : ''}`}>
      {stage}
      {showAmigaDemo ? (
        <AmigaDemoScroll title={demoTitle!} text={demoText!} playing={playing} />
      ) : null}
    </div>
  );
}
