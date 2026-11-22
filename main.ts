import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

// Tiny stack VM for make.fun's ISA v1.
// Reads every /input/<id>/ (program.bin + input.bin) and writes
// /output/<id>/stdout.bin and /output/<id>/exit.txt for each one.
// Deterministic: no clock, no environment, no randomness.

const SMAX = 256; // data stack depth
const CMAX = 64; // call stack depth
const MW = 256; // memory words
const SLIM = 1000000; // step limit
const OMAX = 65536; // output byte limit
const enc = new TextEncoder();

// Opcode spec table: [opcode, immediate bytes, pops, pushes].
const spec: number[][] = [
  [0, 0, 0, 0], [1, 1, 0, 1], [2, 4, 0, 1], [3, 0, 1, 0],
  [4, 0, 1, 2], [5, 0, 2, 2], [6, 0, 2, 3], [7, 0, 3, 3],
  [16, 0, 2, 1], [17, 0, 2, 1], [18, 0, 2, 1], [19, 0, 2, 1],
  [20, 0, 2, 1], [21, 0, 2, 1], [22, 0, 2, 1], [23, 0, 1, 1],
  [24, 0, 2, 1], [25, 0, 2, 1], [26, 0, 2, 1], [27, 0, 1, 1],
  [28, 0, 2, 1], [29, 0, 2, 1], [30, 0, 2, 1], [32, 0, 2, 1],
  [33, 0, 2, 1], [34, 0, 2, 1], [48, 2, 0, 0], [49, 2, 1, 0],
  [50, 2, 1, 0], [51, 2, 0, 0], [52, 0, 0, 0], [64, 0, 1, 1],
  [65, 0, 2, 0], [80, 0, 1, 0], [81, 0, 1, 0], [82, 0, 0, 1],
  [83, 0, 1, 0],
];
const imm = new Uint8Array(256);
const pops = new Uint8Array(256);
const push = new Uint8Array(256);
const valid = new Uint8Array(256);
for (const [o, i, p, q] of spec) {
  valid[o] = 1;
  imm[o] = i;
  pops[o] = p;
  push[o] = q;
}

function run(prog: Buffer, input: Buffer): { out: Uint8Array; exit: number } {
  const n = prog.length;
  const D = new Int32Array(SMAX);
  let sp = 0;
  const C = new Int32Array(CMAX);
  let cp = 0;
  const M = new Int32Array(MW);
  const out = new Uint8Array(OMAX);
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const end = (e: number) => ({ out: out.slice(0, ol), exit: e });

  for (;;) {
    if (steps === SLIM) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = prog[pc];
    if (!valid[op]) return end(5);
    const im = imm[op];
    if (pc + im >= n) return end(9);
    steps++;
    const nx = pc + 1 + im;
    if (sp < pops[op]) return end(2);
    if (sp - pops[op] + push[op] > SMAX) return end(3);
    pc = nx;
    switch (op) {
      case 0x00:
        return end(0);
      case 0x01:
        D[sp++] = (prog[nx - 1] << 24) >> 24;
        break;
      case 0x02:
        D[sp++] =
          prog[nx - 4] |
          (prog[nx - 3] << 8) |
          (prog[nx - 2] << 16) |
          (prog[nx - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 0x05: {
        const t = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = t;
        break;
      }
      case 0x06:
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 0x07: {
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 0x17:
        D[sp - 1] = (-D[sp - 1]) | 0;
        break;
      case 0x1b:
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
      case 0x16: case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d:
      case 0x1e: case 0x20: case 0x21: case 0x22: {
        const b = D[sp - 1];
        const a = D[sp - 2];
        let r = 0;
        if (op >= 0x13 && op <= 0x16 && b === 0) return end(4); // DIV/MOD/DIVU/MODU by zero
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13:
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 0x14:
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 0x15:
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16:
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          case 0x22: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        }
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[nx - 2] | (prog[nx - 1] << 8)) << 16) >> 16;
        if (op === 0x30) {
          pc = nx + rel;
          break;
        }
        const v = D[--sp];
        if ((op === 0x31 && v === 0) || (op === 0x32 && v !== 0)) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === CMAX) return end(7);
        C[cp++] = nx;
        pc = prog[nx - 2] | (prog[nx - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return end(8);
        pc = C[--cp];
        break;
      case 0x40: {
        const a = D[sp - 1];
        if (a < 0 || a >= MW) return end(6);
        D[sp - 1] = M[a];
        break;
      }
      case 0x41: {
        const a = D[sp - 1];
        const v = D[sp - 2];
        if (a < 0 || a >= MW) return end(6);
        sp -= 2;
        M[a] = v;
        break;
      }
      case 0x50: {
        const s = enc.encode(String(D[sp - 1]));
        if (ol + s.length > OMAX) return end(11);
        sp--;
        out.set(s, ol);
        ol += s.length;
        break;
      }
      case 0x51:
        if (ol + 1 > OMAX) return end(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = ip < input.length ? input[ip++] : -1;
        break;
      case 0x53:
        return end(D[--sp] & 255);
    }
  }
}

// Env stand-ins for /input and /output outside a container (the kit starter's pattern).
const IN = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

const ids = readdirSync(IN).sort();
for (const id of ids) {
  const prog = readFileSync(`${IN}/${id}/program.bin`);
  const inp = readFileSync(`${IN}/${id}/input.bin`);
  const { out, exit } = run(prog, inp);
  mkdirSync(`${OUT}/${id}`, { recursive: true });
  writeFileSync(`${OUT}/${id}/stdout.bin`, out);
  writeFileSync(`${OUT}/${id}/exit.txt`, String(exit));
}
