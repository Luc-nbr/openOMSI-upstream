// The route preview. Its ground is the game's own city map: the game program builds it with
// the city map's code and palette (`map_ground`, `omsi_navigator::MapGround`) and it is drawn
// here as the game draws it, with WebGL - the land, water and woods, every paved surface and
// carriageway, the tracks and the houses, their details coming and going at the city map's
// scales. Over it the trip's route in blue on the very lanes the game drives, its stops with
// their times, and the entry points - one clicked is where the bus starts. Dragged to move,
// the wheel to zoom where the mouse is, eased as the game's map eases. (Without WebGL, or a
// game program that does not build the ground, the page draws the map's layers itself.)

import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { call } from './api.js';
import { t, plain } from './i18n.js';
import { Spinner } from './ui.js';

const cache = new Map();

/** The stop objects stand beside the road; their dots go onto the route itself: the nearest
 * point of the route's lanes (within 40 m - a stop the route misses stays where it is). */
function onRoute(d) {
  for (const s of d.stops) {
    let best = null;
    let bd = 40 * 40;
    for (const p of d.route) {
      for (let i = 0; i + 3 < p.length; i += 2) {
        const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
        const vx = bx - ax;
        const vy = by - ay;
        const l = vx * vx + vy * vy || 1;
        const k = Math.max(0, Math.min(1, ((s.at[0] - ax) * vx + (s.at[1] - ay) * vy) / l));
        const x = ax + vx * k;
        const y = ay + vy * k;
        const dd = (x - s.at[0]) ** 2 + (y - s.at[1]) ** 2;
        if (dd < bd) (bd = dd), (best = [x, y]);
      }
    }
    if (best) s.at = best;
  }
  return d;
}


// The map package's surface (`d.package`, see docs/MAP_PACKAGE.md): its triangles and lines as
// Path2D objects in map metres, made once and drawn under a transform that follows the view.
const FILL_KEYS = ['water', 'green', 'built', 'grass', 'forest', 'sport', 'farm']; // by class
const FILL_LOOK = ['water', 'park', 'built', 'grass', 'forest', 'sport', 'field'];
const FILL_ORDER = [2, 6, 3, 1, 4, 5, 0]; // under everything: built-up land first, water last

function surfacePaths(pkg) {
  if (pkg.paths) return pkg.paths;
  const fills = pkg.fills.map((f) => {
    const path = new Path2D();
    for (let i = 0; i + 5 < f.length; i += 6) {
      path.moveTo(f[i], f[i + 1]);
      path.lineTo(f[i + 2], f[i + 3]);
      path.lineTo(f[i + 4], f[i + 5]);
      path.closePath();
    }
    return path;
  });
  // a river's width tells river from stream; the railway and the borders are one path each
  const lines = { river: new Path2D(), stream: new Path2D(), rail: new Path2D(), border: new Path2D() };
  for (const l of pkg.lines) {
    const path = l.c === 0 ? (l.w >= 5 ? lines.river : lines.stream) : l.c === 1 ? lines.rail : l.c === 2 ? lines.border : null;
    if (!path) continue;
    for (let i = 0; i + 1 < l.p.length; i += 2) (i ? path.lineTo : path.moveTo).call(path, l.p[i], l.p[i + 1]);
  }
  return (pkg.paths = { fills, lines });
}

/** The surface under the roads: ground, areas, then rivers, rail and borders. */
function drawSurface(g, pkg, v, W, H) {
  const c = LOOK === LOOKS.light && pkg.colors;
  const { fills, lines } = surfacePaths(pkg);
  g.save();
  // map metres (y up) onto the canvas: widths below are pixels, so they are scaled by `mpp`
  g.translate(W / 2 - v.cx / v.mpp, H / 2 + v.cy / v.mpp);
  g.scale(1 / v.mpp, -1 / v.mpp);
  g.lineCap = g.lineJoin = 'round';
  for (const k of FILL_ORDER) {
    g.fillStyle = g.strokeStyle = c ? c[FILL_KEYS[k]] : LOOK[FILL_LOOK[k]];
    g.fill(fills[k]);
    g.lineWidth = 0.8 * v.mpp; // (no seams between neighbouring triangles)
    g.stroke(fills[k]);
  }
  const stroke = (path, color, px) => {
    g.strokeStyle = color;
    g.lineWidth = px * v.mpp;
    g.stroke(path);
  };
  stroke(lines.river, c ? c.river : LOOK.river, 6);
  stroke(lines.stream, c ? c.river : LOOK.river, 2.4);
  stroke(lines.rail, c ? c.rail_edge : LOOK.rail, 3.4);
  stroke(lines.rail, c ? c.rail : LOOK.railDash, 1.6);
  g.globalAlpha = 0.7;
  stroke(lines.border, c ? c.border : LOOK.border, 1.2);
  g.restore();
}

const LOOKS = {
  light: {
    land: '#d8ecc8', grass: '#d8ecc8', forest: '#c3e0ae', field: '#eef0d8', paved: '#eceae4', sand: '#f3ead2', water: '#a6d3f5',
    park: '#d3eac1', built: '#efebe3', sport: '#cfe9c8', river: '#a6d3f5', border: '#b9a9c9',
    road: '#ffffff', roadEdge: '#dcd8cf', main: '#fbe08a', mainEdge: '#e5bd55', foot: '#f8f7f3', footEdge: '#e4e1d9', area: '#efedea', areaEdge: '#dedbd6',
    roof: '#e9e6df', roofEdge: '#d6d1c7', shadow: 'rgba(60,64,52,0.10)', rail: '#b2afa8', railDash: '#ffffff', tram: '#a59fb2',
    route: '#0a84ff', routeEdge: '#0060df', pin: '#ffffff', card: 'rgba(255,255,255,0.96)', cardShadow: 'rgba(0,0,0,0.16)', text: '#1c1c1e', dim: '#6e6e73', entry: '#ff9f0a',
  },
  dark: {
    land: '#22322a', grass: '#22322a', forest: '#1f3527', field: '#2b2f29', paved: '#2e3033', sand: '#36332b', water: '#1d3550',
    park: '#213628', built: '#2c2d31', sport: '#22362b', river: '#1d3550', border: '#6b5d7a',
    road: '#4a4d53', roadEdge: '#323438', main: '#8a7a4e', mainEdge: '#5c5236', foot: '#34363a', footEdge: '#2c2e31', area: '#313337', areaEdge: '#2a2c2f',
    roof: '#3a3c41', roofEdge: '#46494f', shadow: 'rgba(0,0,0,0.28)', rail: '#5d5f64', railDash: '#2f3134', tram: '#6a6478',
    route: '#0a84ff', routeEdge: '#0a5bd1', pin: '#f2f2f7', card: 'rgba(44,44,46,0.96)', cardShadow: 'rgba(0,0,0,0.5)', text: '#f2f2f7', dim: '#98989d', entry: '#ff9f0a',
  },
};
let LOOK = LOOKS.light;
// land classes in the order they are laid: grass, field, sand, paved, forest, water
const CHUNK = 1024;
const LAND = [[0, 'grass'], [2, 'field'], [4, 'sand'], [3, 'paved'], [1, 'forest'], [5, 'water']];

function pathOf(c) {
  if (c.path) return c.path;
  const { t, s, e } = c;
  const path = new Path2D();
  for (let i = s; i < e; i += 6) {
    path.moveTo(t[i], t[i + 1]);
    path.lineTo(t[i + 2], t[i + 3]);
    path.lineTo(t[i + 4], t[i + 5]);
    path.closePath();
  }
  return (c.path = path);
}

/** The layers' triangles and outlines as Path2D objects in map metres, made once. */
function layerPaths(l) {
  if (l.paths) return l.paths;
  const tris = (t) => {
    const out = [];
    for (let s = 0; s + 5 < t.length; s += CHUNK * 6) {
      const e = Math.min(s + CHUNK * 6, t.length - 5);
      const lo = [Infinity, Infinity];
      const hi = [-Infinity, -Infinity];
      for (let i = s; i < e; i += 2) {
        const x = t[i];
        const y = t[i + 1];
        if (x < lo[0]) lo[0] = x;
        if (x > hi[0]) hi[0] = x;
        if (y < lo[1]) lo[1] = y;
        if (y > hi[1]) hi[1] = y;
      }
      out.push({ t, s, e, lo, hi, path: null });
    }
    return out;
  };
  const ring = (path, p, dx = 0, dy = 0) => {
    for (let i = 0; i + 1 < p.length; i += 2) (i ? path.lineTo : path.moveTo).call(path, p[i] + dx, p[i + 1] + dy);
    path.closePath();
  };
  const houses = new Path2D();
  const shadows = new Path2D();
  for (const h of l.houses) {
    ring(houses, h.p);
    // (the shadow falls south-east, longer for a taller house)
    const k = Math.min(h.h, 40) * 0.12;
    ring(shadows, h.p, k, -k);
  }
  const rail = new Path2D();
  const tram = new Path2D();
  for (const x of l.lines) {
    const path = x.c === 0 ? rail : x.c === 1 ? tram : null;
    if (!path) continue;
    for (let i = 0; i + 1 < x.p.length; i += 2) (i ? path.lineTo : path.moveTo).call(path, x.p[i], x.p[i + 1]);
  }
  return (l.paths = { land: l.land.map(tris), paved: l.paved.map(tris), houses, shadows, rail, tram });
}

/** The ground, the paved surfaces, the tracks and the houses, under the roads' middles. */
function drawLayers(g, l, v, W, H) {
  const P = layerPaths(l);
  g.save();
  g.translate(W / 2 - v.cx / v.mpp, H / 2 + v.cy / v.mpp);
  g.scale(1 / v.mpp, -1 / v.mpp);
  g.lineCap = g.lineJoin = 'round';
  const x0 = v.cx - (W / 2 + 4) * v.mpp;
  const x1 = v.cx + (W / 2 + 4) * v.mpp;
  const y0 = v.cy - (H / 2 + 4) * v.mpp;
  const y1 = v.cy + (H / 2 + 4) * v.mpp;
  const seen = (chunks) => (chunks || []).filter((c) => c.hi[0] >= x0 && c.lo[0] <= x1 && c.hi[1] >= y0 && c.lo[1] <= y1);
  const fill = (chunks, color, seam = 0.8) => {
    g.fillStyle = g.strokeStyle = color;
    g.lineWidth = seam * v.mpp; // (no seams between neighbouring triangles)
    for (const c of seen(chunks)) {
      g.fill(pathOf(c));
      g.stroke(pathOf(c));
    }
  };
  for (const [k, key] of LAND) fill(P.land[k], LOOK[key]);
  const near = v.mpp < 2.5;
  // pavements and yards (near), carriageways: an edge, then the surface
  const paved = near ? [[1, 'foot', 'footEdge'], [2, 'area', 'areaEdge'], [0, 'road', 'roadEdge']] : [[2, 'area', 'areaEdge'], [0, 'road', 'roadEdge']];
  for (const [k, f, e] of paved) {
    g.strokeStyle = LOOK[e];
    g.lineWidth = 2 * v.mpp;
    for (const c of seen(P.paved[k])) g.stroke(pathOf(c));
    fill(P.paved[k], LOOK[f]);
  }
  g.strokeStyle = LOOK.rail;
  g.lineWidth = Math.max(3.4, 3.6 / v.mpp) * v.mpp;
  g.stroke(P.rail);
  if (near) {
    g.setLineDash([9, 9]);
    g.strokeStyle = LOOK.railDash;
    g.lineWidth = Math.max(1.4, 1.3 / v.mpp) * v.mpp;
    g.stroke(P.rail);
    g.setLineDash([]);
  }
  g.strokeStyle = LOOK.tram;
  g.lineWidth = 1.3 * v.mpp;
  g.stroke(P.tram);
  if (v.mpp < 6) {
    g.fillStyle = LOOK.shadow;
    g.fill(P.shadows);
    g.fillStyle = LOOK.roof;
    g.strokeStyle = LOOK.roofEdge;
    g.lineWidth = 0.8 * v.mpp;
    g.fill(P.houses);
    g.stroke(P.houses);
  }
  g.restore();
}

// --- The ground as the game builds it (`map_ground`)

/** The city map's ground around `at` (metres from the page's origin) at `mpp`: the head and
 * the vertices (28 bytes each, see `map_ground` in the game's launcher service). */
async function readGround(map, date, at, reach, mpp, light) {
  const buf = await call('map_ground', { map, date, x: at[0], y: at[1], reach, mpp, light });
  const n = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  return { head, verts: buf.slice(4 + n) };
}

// the game's own vertex rule (omsi-ui's `ui.wgsl`): a vertex moves out along its extrusion
// by the larger of its width in metres and its width in pixels at this scale
const VS = `attribute vec2 p; attribute vec2 e; attribute vec2 w; attribute vec4 c;
uniform vec2 centre; uniform float mpp; uniform vec2 hsize;
varying vec4 v;
void main() {
  vec2 q = p + e * max(w.x, w.y * mpp);
  gl_Position = vec4((q - centre) / mpp / hsize, 0.0, 1.0);
  v = c;
}`;
const FS = `precision mediump float; varying vec4 v; void main() { gl_FragColor = vec4(v.rgb * v.a, v.a); }`;

/** A WebGL picture of the ground on `canvas`; none where the browser has no WebGL. */
function groundGl(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: false });
  if (!gl) return null;
  const sh = (type, src) => {
    const o = gl.createShader(type);
    gl.shaderSource(o, src);
    gl.compileShader(o);
    return o;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const at = (n) => gl.getAttribLocation(prog, n);
  const un = (n) => gl.getUniformLocation(prog, n);
  return { gl, prog, buf: gl.createBuffer(), a: { p: at('p'), e: at('e'), w: at('w'), c: at('c') }, u: { centre: un('centre'), mpp: un('mpp'), hsize: un('hsize') }, count: 0 };
}

/** Upload a ground the game built. */
function uploadGround(g, ground) {
  const { gl } = g;
  gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
  gl.bufferData(gl.ARRAY_BUFFER, ground.verts, gl.STATIC_DRAW);
  g.count = ground.verts.byteLength / 28;
  g.anchor = ground.head.anchor;
}

/** Draw the uploaded ground with the view `v` (centre and metres a pixel) on a W x H page. */
function drawGround(g, v, W, H, dpr, land) {
  const { gl, a, u } = g;
  gl.viewport(0, 0, Math.round(W * dpr), Math.round(H * dpr));
  const [r, gr, b] = land;
  gl.clearColor(r, gr, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!g.count) return;
  gl.useProgram(g.prog);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
  gl.enableVertexAttribArray(a.p);
  gl.vertexAttribPointer(a.p, 2, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(a.e);
  gl.vertexAttribPointer(a.e, 2, gl.FLOAT, false, 28, 8);
  gl.enableVertexAttribArray(a.w);
  gl.vertexAttribPointer(a.w, 2, gl.FLOAT, false, 28, 16);
  gl.enableVertexAttribArray(a.c);
  gl.vertexAttribPointer(a.c, 4, gl.UNSIGNED_BYTE, true, 28, 24);
  gl.uniform2f(u.centre, v.cx - g.anchor[0], v.cy - g.anchor[1]);
  gl.uniform1f(u.mpp, v.mpp);
  gl.uniform2f(u.hsize, W / 2, H / 2);
  gl.drawArrays(gl.TRIANGLES, 0, g.count);
}

/** `rgba(r,g,b,a)` as 0..1 numbers. */
const rgb = (css) => (css?.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map((x) => x / 255);

/** The city map's level of detail at `mpp` (`city_ground`'s scales): a new ground is built
 * when it changes. */
const detail = (mpp) => (mpp < 0.7 ? 1 : 0) | (mpp < 2.2 ? 2 : 0) | (mpp < 3.5 ? 4 : 0) | (mpp < 6 ? 8 : 0);

const surfaces = new Map();
let drawn = 0;

export async function readRouteMap(map, date, trip, surface = true) {
  return JSON.parse(new TextDecoder().decode(await call('route_map', { map, date, trip, surface })));
}

const surfaceNow = new Map();

function surfaceOf(map, date) {
  const at = `${map}|${date}`;
  if (!surfaces.has(at)) {
    surfaces.set(at, readRouteMap(map, date, '', true).then(
      (d) => {
        const s = { package: d.package, layers: d.layers };
        surfaceNow.set(at, s);
        return s;
      },
      () => (surfaces.delete(at), null),
    ));
  }
  return surfaces.get(at);
}

function load(map, date, trip) {
  const key = `${map}|${date}|${trip}`;
  if (!cache.has(key)) cache.set(key, readRouteMap(map, date, trip, false).then(onRoute, (e) => ({ error: e.message })));
  return cache.get(key);
}

const withSurface = (d, s) => ({ ...d, package: s?.package ?? d.package, layers: s?.layers ?? d.layers, id: ++drawn });

function roadPaths(d) {
  if (d.roadPaths) return d.roadPaths;
  const groups = new Map();
  for (const r of d.roads) {
    const w = Math.round(r.w * 2) / 2;
    const k = `${r.main ? 1 : 0}|${w}`;
    if (!groups.has(k)) groups.set(k, { main: !!r.main, w, path: new Path2D() });
    const path = groups.get(k).path;
    for (let i = 0; i + 1 < r.p.length; i += 2) (i ? path.lineTo : path.moveTo).call(path, r.p[i], r.p[i + 1]);
  }
  return (d.roadPaths = [...groups.values()]);
}

function drawRoads(g, d, v, W, H) {
  const paved = !!d.layers && v.mpp < 2.5;
  g.save();
  g.translate(W / 2 - v.cx / v.mpp, H / 2 + v.cy / v.mpp);
  g.scale(1 / v.mpp, -1 / v.mpp);
  g.lineCap = g.lineJoin = 'round';
  for (let pass = 0; pass < 4; pass++) {
    const main = pass % 2 === 1;
    const top = pass > 1;
    const gold = main && !paved;
    g.strokeStyle = top ? (gold ? LOOK.main : LOOK.road) : gold ? LOOK.mainEdge : LOOK.roadEdge;
    for (const r of roadPaths(d)) {
      if (r.main !== main) continue;
      const w = paved ? Math.max(r.w - 1.2, 1.5) : r.w;
      g.lineWidth = Math.max((w + (top ? 0 : paved ? 0 : 1.2)) / v.mpp, top ? (main ? 2.2 : 1.4) : main ? 3.4 : 2.6) * v.mpp;
      g.stroke(r.path);
    }
  }
  g.restore();
}

/** The view that shows `d`: the trip's route when there is one, else the map, framed in the
 * part of the W x H page `inset` leaves free. */
function fit(d, W, H, inset, el) {
  let lo = d.lo;
  let hi = d.hi;
  if (d.route.length) {
    lo = [Infinity, Infinity];
    hi = [-Infinity, -Infinity];
    for (const p of d.route) for (let i = 0; i < p.length; i += 2) {
      lo = [Math.min(lo[0], p[i]), Math.min(lo[1], p[i + 1])];
      hi = [Math.max(hi[0], p[i]), Math.max(hi[1], p[i + 1])];
    }
  }
  const k = inset?.(el) || { l: 0, t: 0, r: 0, b: 0 };
  const fw = Math.max(W - k.l - k.r, W / 3);
  const fh = Math.max(H - k.t - k.b, H / 3);
  const span = Math.max((hi[0] - lo[0]) / Math.max(fw - (inset ? 220 : 80), fw / 2), (hi[1] - lo[1]) / Math.max(fh - (inset ? 90 : 60), fh / 2), 0.2);
  const ox = Math.min(k.l, W - fw) + fw / 2 - W / 2;
  const oy = Math.min(k.t, H - fh) + fh / 2 - H / 2;
  return { cx: (lo[0] + hi[0]) / 2 - ox * span, cy: (lo[1] + hi[1]) / 2 + oy * span, mpp: span };
}

const MIN_MPP = 0.15;
const MAX_MPP = 200;

export function RouteMap({ map, date, trip, stops = [], entry = -1, onEntry, height = 340, inset }) {
  const box = useRef();
  const cv = useRef();
  const gcv = useRef();
  const [data, setData] = useState(null);
  // the view drawn now, and the one it eases to (the game's map eases its zoom the same way)
  const view = useRef(null);
  const aim = useRef(null);
  const refit = useRef(false);
  const base = useRef(null);
  const settle = useRef(0);
  const frame = useRef(0);
  const [hover, setHover] = useState(-1);
  // the ground the game built (null: not asked yet, false: this browser or game cannot)
  const gl = useRef(null);
  const ground = useRef({ built: null, asking: null, failed: false });

  useEffect(() => {
    if (!map) return;
    let alive = true;
    const surface = surfaceOf(map, date);
    load(map, date, trip).then((d) => {
      if (!alive) return;
      const now = surfaceNow.get(`${map}|${date}`);
      setData(d.error ? d : withSurface(d, now));
      // (a new trip: the view flies to it rather than jumping)
      refit.current = true;
      if (d.error || now) return;
      surface.then((s) => alive && s && setData((cur) => (cur && !cur.error ? withSurface(cur, s) : cur)));
    });
    return () => (alive = false);
  }, [map, date, trip]);

  // a new map: its own ground
  useEffect(() => {
    ground.current = { built: null, asking: null, failed: false };
    if (gl.current) gl.current.count = 0;
  }, [map, date]);

  /** Ask the game for the ground around the view when the one there is does not cover it,
   * or is of another level of detail - as the city map asks for its own. */
  const wantGround = (v, W, H, light) => {
    const G = ground.current;
    if (G.failed || G.asking || !map) return;
    const reach = Math.max(500, Math.max(W, H) * v.mpp * 0.8);
    const b = G.built;
    const fresh = b && b.light === light && detail(b.mpp) === detail(v.mpp) && Math.hypot(b.at[0] - v.cx, b.at[1] - v.cy) <= b.reach * 0.35 && b.mpp / v.mpp <= 1.7 && v.mpp / b.mpp <= 1.7;
    if (fresh) return;
    const ask = { at: [v.cx, v.cy], reach, mpp: v.mpp, light };
    G.asking = ask;
    readGround(map, date, ask.at, reach, v.mpp, light).then(
      (got) => {
        if (ground.current !== G) return;
        G.asking = null;
        if (gl.current) uploadGround(gl.current, got);
        G.built = ask;
        G.palette = got.head.palette;
        latest.current();
      },
      () => {
        if (ground.current !== G) return;
        G.asking = null;
        G.failed = true;
        latest.current();
      },
    );
  };

  // the picture, drawn again whenever anything it shows changes
  const draw = (fast = false) => {
    const c = cv.current;
    const d = data;
    if (!c || !d || d.error) return;
    const dpr = window.devicePixelRatio || 1;
    const light = document.documentElement.dataset.theme === 'light';
    LOOK = light ? LOOKS.light : LOOKS.dark;
    const W = box.current.clientWidth;
    const H = box.current.clientHeight;
    if (!W || !H) return;
    for (const el of [c, gcv.current]) {
      if (el && (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr))) Object.assign(el, { width: Math.round(W * dpr), height: Math.round(H * dpr) });
    }
    if (!view.current) {
      view.current = fit(d, W, H, inset, box.current);
      aim.current = { ...view.current };
      refit.current = false;
    } else if (refit.current) {
      refit.current = false;
      aim.current = fit(d, W, H, inset, box.current);
      aim.current.zoomAt = null;
      animate();
    }
    const v = view.current;
    if (gl.current === null && gcv.current) gl.current = groundGl(gcv.current) || false;
    const G = ground.current;
    const onGl = !!gl.current && !G.failed;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (onGl) {
      wantGround(v, W, H, light);
      drawGround(gl.current, v, W, H, dpr, rgb(G.palette?.land || LOOK.land));
      g.clearRect(0, 0, W, H);
    } else {
      // (the page's own drawing of the map's layers, when the game builds no ground)
      const key = `${d.id}|${W}x${H}@${dpr}|${light}`;
      const b = base.current;
      const moved = !b || b.view.cx !== v.cx || b.view.cy !== v.cy || b.view.mpp !== v.mpp;
      if (!b || b.key !== key || (moved && fast !== true)) {
        const canvas = b?.canvas || document.createElement('canvas');
        Object.assign(canvas, { width: Math.round(W * dpr), height: Math.round(H * dpr) });
        const bg = canvas.getContext('2d');
        bg.setTransform(dpr, 0, 0, dpr, 0, 0);
        bg.fillStyle = LOOK.land;
        bg.fillRect(0, 0, W, H);
        if (d.package) drawSurface(bg, d.package, v, W, H);
        if (d.layers) drawLayers(bg, d.layers, v, W, H);
        drawRoads(bg, d, v, W, H);
        base.current = { canvas, key, view: { ...v } };
      }
      g.fillStyle = LOOK.land;
      g.fillRect(0, 0, W, H);
      const bv = base.current.view;
      const k = bv.mpp / v.mpp;
      g.drawImage(base.current.canvas, W / 2 + (bv.cx - v.cx) / v.mpp - (W / 2) * k, H / 2 - (bv.cy - v.cy) / v.mpp - (H / 2) * k, W * k, H * k);
    }
    // the route and the cards in the game's colours where it gave them
    const P = (onGl && G.palette) || null;
    const routeColor = P?.route || LOOK.route;
    const X = (x) => W / 2 + (x - v.cx) / v.mpp;
    const Y = (y) => H / 2 - (y - v.cy) / v.mpp;
    const line = (p) => {
      g.beginPath();
      for (let i = 0; i < p.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(p[i]), Y(p[i + 1]));
    };
    g.lineCap = g.lineJoin = 'round';
    for (const [color, wide] of [[P?.route_edge || LOOK.routeEdge, 7], [routeColor, 4.6]]) {
      g.strokeStyle = color;
      g.lineWidth = wide;
      for (const p of d.route) {
        line(p);
        g.stroke();
      }
    }
    // stops: white pins with the bus's blue, a card with the time and name beside
    g.font = '600 11.5px Inter, sans-serif';
    // (a label that would cover one already written goes to the left of its stop, else away)
    const taken = [];
    const free = (x, y, w) => !taken.some((r) => x < r[0] + r[2] && x + w > r[0] && y < r[1] + 20 && y + 20 > r[1]);
    for (const s of d.stops) {
      const x = X(s.at[0]);
      const y = Y(s.at[1]);
      g.fillStyle = LOOK.pin;
      g.beginPath();
      g.arc(x, y, 5.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = routeColor;
      g.beginPath();
      g.arc(x, y, 3.6, 0, Math.PI * 2);
      g.fill();
      const st = stops[s.k];
      if (st) {
        const label = `${st.time}  ${st.name}`;
        const w = g.measureText(label).width + 14;
        const lx = [x + 10, x - 10 - w].find((lx) => free(lx, y - 10, w));
        if (lx === undefined) continue;
        taken.push([lx, y - 10, w]);
        g.save();
        g.shadowColor = LOOK.cardShadow;
        g.shadowBlur = 6;
        g.fillStyle = P?.card || LOOK.card;
        g.beginPath();
        g.roundRect(lx, y - 10, w, 20, 7);
        g.fill();
        g.restore();
        g.fillStyle = routeColor;
        g.fillText(plain(st.time), lx + 7, y + 4);
        g.fillStyle = P?.card_text || LOOK.text;
        g.fillText(plain(st.name), lx + 7 + g.measureText(`${st.time}  `).width, y + 4);
      }
    }
    // entry points: amber, the hovered one ringed grey, the chosen one white
    d.entries.forEach((e, i) => {
      const x = X(e.at[0]);
      const y = Y(e.at[1]);
      g.fillStyle = LOOK.pin;
      g.beginPath();
      g.arc(x, y, 5.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = LOOK.entry;
      g.beginPath();
      g.arc(x, y, 3.8, 0, Math.PI * 2);
      g.fill();
      if (i === hover || e.index === entry) {
        g.strokeStyle = e.index === entry ? routeColor : '#8e8e93';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, e.index === entry ? 10 : 7.5, 0, Math.PI * 2);
        g.stroke();
      }
    });
    if (hover >= 0 && d.entries[hover]) {
      const e = d.entries[hover];
      g.font = '500 12px Inter, sans-serif';
      const w = g.measureText(e.name).width + 12;
      g.fillStyle = 'rgba(28,30,33,0.94)';
      g.beginPath();
      g.roundRect(X(e.at[0]) - w / 2, Y(e.at[1]) - 34, w, 22, 8);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(plain(e.name), X(e.at[0]) - w / 2 + 6, Y(e.at[1]) - 19);
    }
  };
  const latest = useRef(draw);
  latest.current = draw;

  /** Ease the view to `aim` frame by frame (a zoom keeps the point under the mouse where it
   * is, as the city map's wheel does), then draw it once more in full. */
  const animate = () => {
    if (frame.current) return;
    let last = performance.now();
    const step = (now) => {
      const v = view.current;
      const a = aim.current;
      if (!v || !a) return (frame.current = 0);
      const k = 1 - Math.exp(-Math.min(now - last, 100) / 1000 * 14);
      last = now;
      const mpp = Math.exp(Math.log(v.mpp) + (Math.log(a.mpp) - Math.log(v.mpp)) * k);
      if (a.zoomAt) {
        const { px, py, wx, wy, W, H } = a.zoomAt;
        v.mpp = mpp;
        v.cx = wx - (px - W / 2) * mpp;
        v.cy = wy + (py - H / 2) * mpp;
      } else {
        v.mpp = mpp;
        v.cx += (a.cx - v.cx) * k;
        v.cy += (a.cy - v.cy) * k;
      }
      const done = Math.abs(Math.log(v.mpp / a.mpp)) < 0.002 && (a.zoomAt || Math.hypot(a.cx - v.cx, a.cy - v.cy) < v.mpp * 0.3);
      if (done) {
        v.mpp = a.mpp;
        if (!a.zoomAt) [v.cx, v.cy] = [a.cx, a.cy];
        frame.current = 0;
        latest.current();
        return;
      }
      latest.current(true);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  useEffect(() => draw(), [data, hover, entry, stops.map((x) => `${x.time} ${x.name}`).join('|')]);
  useEffect(() => () => (clearTimeout(settle.current), cancelAnimationFrame(frame.current)), []);
  useEffect(() => {
    const redraw = () => latest.current();
    const ro = new ResizeObserver(redraw);
    ro.observe(box.current);
    document.fonts?.ready.then(redraw);
    const theme = new MutationObserver(redraw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scale = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    scale.addEventListener('change', redraw);
    return () => {
      ro.disconnect();
      theme.disconnect();
      scale.removeEventListener('change', redraw);
    };
  }, []);

  const at = (e) => {
    const r = cv.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const entryAt = ([px, py]) => {
    const d = data;
    const v = view.current;
    if (!d?.entries || !v) return -1;
    const W = box.current.clientWidth;
    const H = box.current.clientHeight;
    let best = -1;
    let bd = 12 * 12;
    d.entries.forEach((e, i) => {
      const dx = W / 2 + (e.at[0] - v.cx) / v.mpp - px;
      const dy = H / 2 - (e.at[1] - v.cy) / v.mpp - py;
      if (dx * dx + dy * dy < bd) (bd = dx * dx + dy * dy), (best = i);
    });
    return best;
  };
  const drag = useRef(null);
  return html`<div class="routemap" ref=${box} style=${height ? `height:${height}px` : ''}
      onPointerDown=${(e) => {
        drag.current = { p: at(e), moved: 0 };
        // (a drag takes the map where it is: an easing in progress stops there)
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        if (view.current) aim.current = { ...view.current, zoomAt: null };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove=${(e) => {
        const p = at(e);
        const d = drag.current;
        if (d && view.current) {
          const dx = p[0] - d.p[0];
          const dy = p[1] - d.p[1];
          d.moved += Math.abs(dx) + Math.abs(dy);
          d.p = p;
          view.current.cx -= dx * view.current.mpp;
          view.current.cy += dy * view.current.mpp;
          aim.current = { ...view.current, zoomAt: null };
          draw(true);
        } else {
          const h = entryAt(p);
          if (h !== hover) setHover(h);
        }
      }}
      onPointerUp=${(e) => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) draw();
        if (d && d.moved < 5) {
          const i = entryAt(at(e));
          if (i >= 0) onEntry?.(data.entries[i].index);
        }
      }}
      onPointerLeave=${() => setHover(-1)}
      onWheel=${(e) => {
        e.preventDefault();
        const v = view.current;
        if (!v) return;
        const [px, py] = at(e);
        const W = box.current.clientWidth;
        const H = box.current.clientHeight;
        // the point under the mouse stays there; a trackpad's small steps zoom little
        const a = aim.current?.zoomAt ? aim.current : { ...v };
        const wx = v.cx + (px - W / 2) * v.mpp;
        const wy = v.cy - (py - H / 2) * v.mpp;
        const k = Math.exp(Math.max(-1, Math.min(1, e.deltaY * (e.deltaMode ? 0.05 : 0.0025))) * 0.6);
        aim.current = { cx: v.cx, cy: v.cy, mpp: Math.min(Math.max(a.mpp * k, MIN_MPP), MAX_MPP), zoomAt: { px, py, wx, wy, W, H } };
        animate();
      }}>
    <canvas ref=${gcv} class="ground"></canvas>
    <canvas ref=${cv} class="over"></canvas>
    ${!data && html`<div class="state"><${Spinner} /> ${t('Reading the map…')}</div>`}
    ${data?.error && html`<div class="state">${data.error}</div>`}
    ${data?.package?.credit && html`<div class="credit">${data.package.credit}</div>`}
    ${data && !data.error && html`<div class="legend">${t('{roads} roads | {stops} stops | {entries} entry points', { roads: data.roads.length, stops: data.stops.length, entries: data.entries.length })}</div>`}
  </div>`;
}
