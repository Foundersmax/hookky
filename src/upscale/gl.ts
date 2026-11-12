// The upscaler's image pipeline, on the GPU (WebGL2). Four steps per frame:
//   1. Clean    — at the source size: an edge-preserving filter that takes out compression
//                 blocks and noise before they're magnified.
//   2. Upscale  — Lanczos-3 resampling in two passes (across, then down), with ringing held to
//                 the neighbouring pixels' range so edges stay crisp without halos.
//   3. Sharpen  — contrast-adaptive sharpening at the target size: strong on soft detail, gentle
//                 on edges that are already hard, so it never overshoots.
//   4. Enrich   — a little vibrance for flat colour and optional fine grain for surface texture.

export interface Look {
  /** 0–1: compression clean-up before scaling */
  clean: number;
  /** 0–1: sharpening after scaling */
  sharp: number;
  /** 0–1: colour vibrance */
  rich: number;
  /** 0–1: fine grain */
  grain: number;
}
export const DEFAULT_LOOK: Look = { clean: 0.25, sharp: 0.7, rich: 0.15, grain: 0 };

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0., 1.); }`;

const CLEAN = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D t; uniform vec2 px; uniform float k;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 c = texture(t, uv).rgb;
  if (k <= 0.001) { o = vec4(c, 1.); return; }
  float lc = luma(c);
  vec3 sum = c; float ws = 1.;
  // neighbours count the more they look like the centre: flat areas smooth, edges stay
  float sigma = mix(0.015, 0.09, k);
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    if (x == 0 && y == 0) continue;
    vec3 s = texture(t, uv + vec2(float(x), float(y)) * px).rgb;
    float d = (luma(s) - lc) / sigma;
    float w = exp(-d * d) * exp(-float(x * x + y * y) / 4.5);
    sum += s * w; ws += w;
  }
  o = vec4(mix(c, sum / ws, 0.35 + 0.65 * k), 1.);
}`;

const LANCZOS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D t; uniform vec2 size; uniform vec2 dir;
const float PI = 3.14159265;
float L(float x){ x = abs(x); if (x < 1e-4) return 1.; if (x >= 3.) return 0.; float a = PI * x; return 3. * sin(a) * sin(a / 3.) / (a * a); }
void main(){
  vec2 pos = uv * size - 0.5;
  float f = dot(fract(pos), dir);
  vec2 base = (floor(pos) + 0.5) / size;
  vec2 stepv = dir / size;
  // the other axis is sampled where it is (bilinear there is exact when sizes match)
  vec2 at = mix(uv, base, dir);
  vec3 sum = vec3(0.); float ws = 0.;
  vec3 c0, c1;
  for (int i = -2; i <= 3; i++) {
    vec3 s = texture(t, at + stepv * float(i)).rgb;
    float w = L(float(i) - f);
    sum += s * w; ws += w;
    if (i == 0) c0 = s;
    if (i == 1) c1 = s;
  }
  vec3 c = sum / ws;
  // hold ringing to the two pixels it sits between
  vec3 lo = min(c0, c1), hi = max(c0, c1);
  o = vec4(mix(c, clamp(c, lo, hi), 0.85), 1.);
}`;

const FINISH = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D t; uniform vec2 px; uniform float sharp, rich, grain, seed, wide2, spanK;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec3 e = texture(t, uv).rgb;
  vec3 c = e;
  if (sharp > 0.001) {
    vec3 b = texture(t, uv + vec2(0., -px.y)).rgb, d = texture(t, uv + vec2(-px.x, 0.)).rgb;
    vec3 f = texture(t, uv + vec2(px.x, 0.)).rgb, h = texture(t, uv + vec2(0., px.y)).rgb;
    vec3 mn = min(min(b, d), min(f, h)), mx = max(max(b, d), max(f, h));
    // how far each channel can be pushed before it clips its neighbourhood
    vec3 hitMin = mn / (4. * mx + 1e-4);
    vec3 hitMax = (1. - mx) / (4. * mn - 4. - 1e-4);
    vec3 lobeC = max(-hitMin, hitMax);
    float lobe = max(-0.1875, min(max(lobeC.r, max(lobeC.g, lobeC.b)), 0.)) * min(1., sharp * 2.);
    c = (lobe * (b + d + f + h) + e) / (4. * lobe + 1.);
    // past halfway, a second wider pass tightens the softness scaling leaves at the size of a
    // source pixel; it's held near what its neighbours span, so edges don't grow halos
    vec2 w2 = px * 2.2;
    vec3 wide = (texture(t, uv + vec2(w2.x, w2.y)).rgb + texture(t, uv + vec2(-w2.x, w2.y)).rgb + texture(t, uv + vec2(w2.x, -w2.y)).rgb + texture(t, uv + vec2(-w2.x, -w2.y)).rgb + b + d + f + h) / 8.;
    vec3 lo = min(mn, e), hi = max(mx, e);
    vec3 span = (hi - lo) * spanK;
    c = clamp(c + (e - wide) * max(0., sharp - 0.5) * wide2, lo - span, hi + span);
  }
  if (rich > 0.001) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    // lift flat colour more than colour that's already strong; a touch of contrast with it
    c = mix(vec3(l), c, 1. + rich * 0.6 * (1. - sat));
    c = mix(c, c * c * (3. - 2. * c), rich * 0.18);
  }
  if (grain > 0.001) {
    float n = hash(uv * vec2(1931., 1087.) + seed) - 0.5;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c += n * grain * 0.07 * (1. - abs(l - 0.5) * 1.2);
  }
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

/** The wide sharpening pass: its strength and how far past its neighbours a pixel may go (tuned on shrink-and-restore tests with photos). */
const WIDE = 1, SPAN = 1;

type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };

export class Upscaler {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private progs: Record<"clean" | "lanczos" | "finish", WebGLProgram>;
  private src: WebGLTexture;
  private targets: Target[] = [];
  private frame = 0;

  /** Throws if WebGL2 isn't available or the output is larger than the GPU allows. */
  constructor(readonly outW: number, readonly outH: number, canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement("canvas");
    this.canvas.width = outW;
    this.canvas.height = outH;
    const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("This browser can't run the upscaler (WebGL2 is off).");
    const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    if (outW > max || outH > max) throw new Error(`This device's graphics can't draw ${outW}×${outH} (its limit is ${max} px).`);
    this.gl = gl;
    const compile = (frag: string) => {
      const mk = (type: number, srcText: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, srcText);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Upscaler shader failed: ${gl.getShaderInfoLog(s)}`);
        return s;
      };
      const p = gl.createProgram()!;
      gl.attachShader(p, mk(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, frag));
      gl.bindAttribLocation(p, 0, "p");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Upscaler program failed: ${gl.getProgramInfoLog(p)}`);
      return p;
    };
    this.progs = { clean: compile(CLEAN), lanczos: compile(LANCZOS), finish: compile(FINISH) };
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.src = this.texture();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  private texture() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private target(i: number, w: number, h: number): Target {
    const gl = this.gl;
    let t = this.targets[i];
    if (!t) {
      t = this.targets[i] = { fb: gl.createFramebuffer()!, tex: this.texture(), w: 0, h: 0 };
    }
    if (t.w !== w || t.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      t.w = w;
      t.h = h;
    }
    return t;
  }
  private pass(prog: WebGLProgram, input: WebGLTexture, out: Target | null, w: number, h: number, set: (u: (n: string) => WebGLUniformLocation | null) => void) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(gl.getUniformLocation(prog, "t"), 0);
    set((n) => gl.getUniformLocation(prog, n));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Process one frame (a video element, image, canvas or VideoFrame) onto `canvas`. */
  render(source: TexImageSource, sw: number, sh: number, look: Look) {
    const gl = this.gl;
    const { outW, outH } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const a = this.target(0, sw, sh);
    this.pass(this.progs.clean, this.src, a, sw, sh, (u) => {
      gl.uniform2f(u("px"), 1 / sw, 1 / sh);
      gl.uniform1f(u("k"), look.clean);
    });
    const b = this.target(1, outW, sh);
    this.pass(this.progs.lanczos, a.tex, b, outW, sh, (u) => {
      gl.uniform2f(u("size"), sw, sh);
      gl.uniform2f(u("dir"), 1, 0);
    });
    const c = this.target(2, outW, outH);
    this.pass(this.progs.lanczos, b.tex, c, outW, outH, (u) => {
      gl.uniform2f(u("size"), outW, sh);
      gl.uniform2f(u("dir"), 0, 1);
    });
    // Sharpening works on detail about the size of a source pixel: scale its reach with the zoom.
    this.pass(this.progs.finish, c.tex, null, outW, outH, (u) => {
      const reach = Math.min(3, Math.max(1, (outW / sw) * 0.5));
      gl.uniform2f(u("px"), reach / outW, reach / outH);
      gl.uniform1f(u("sharp"), look.sharp);
      gl.uniform1f(u("wide2"), WIDE);
      gl.uniform1f(u("spanK"), SPAN);
      gl.uniform1f(u("rich"), look.rich);
      gl.uniform1f(u("grain"), look.grain);
      gl.uniform1f(u("seed"), (this.frame++ * 0.618) % 1);
    });
    gl.flush();
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    gl.deleteTexture(this.src);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
