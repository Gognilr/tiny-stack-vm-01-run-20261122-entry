// Tiny stack VM for make.fun's tiny-stack-vm-01: runs every program of a set
// (program.bin + input.bin under /input/<id>) and writes its exact output
// bytes and exit code to /output/<id>/stdout.bin and /output/<id>/exit.txt.
// Implements the ISA in the kit's generator/subject/ISA.md with every trap
// and limit: wrapping 32-bit arithmetic, exact Math.imul multiplication,
// unsigned DIVU/MODU/LTU, INT_MIN / -1, shifts masked to 5 bits, PUSH8 sign
// extension, EXIT's low byte, stack/call/memory bounds, the 1,000,000-step
// and 65,536-byte-output limits, traps keeping earlier output. Deterministic:
// no clock, no randomness, no I/O outside /input and /output.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Runs one program on its input bytes. Returns its output bytes and exit code.
function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(256); // data stack
  const C = new Int32Array(64); // call stack of return addresses
  const M = new Int32Array(256); // memory, 256 words, zero at start
  const out = new Uint8Array(65536);
  let sp = 0, cp = 0, ol = 0, ip = 0, pc = 0, steps = 0;
  const end = (e) => ({ o: out.slice(0, ol), e });

  for (;;) {
    // Step limit is checked first each step.
    if (steps === 1000000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = p[pc];

    // Per-opcode shape: immediate length, values popped, values pushed.
    // An opcode the ISA does not name traps 5.
    let imm = 0, po = 0, pu = 0;
    switch (op) {
      case 0x00: break; // HALT
      case 0x01: imm = 1; pu = 1; break; // PUSH8
      case 0x02: imm = 4; pu = 1; break; // PUSH32
      case 0x03: po = 1; break; // POP
      case 0x04: po = 1; pu = 2; break; // DUP
      case 0x05: po = 2; pu = 2; break; // SWAP
      case 0x06: po = 2; pu = 3; break; // OVER
      case 0x07: po = 3; pu = 3; break; // ROT
      case 0x17: case 0x1b: po = 1; pu = 1; break; // NEG, NOT
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
      case 0x16: case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d:
      case 0x1e: case 0x20: case 0x21: case 0x22:
        po = 2; pu = 1; break; // two-operand arithmetic / comparison
      case 0x30: case 0x33: imm = 2; break; // JMP, CALL
      case 0x31: case 0x32: imm = 2; po = 1; break; // JZ, JNZ
      case 0x34: break; // RET
      case 0x40: po = 1; pu = 1; break; // LOAD
      case 0x41: po = 2; break; // STORE
      case 0x50: case 0x51: case 0x53: po = 1; break; // PRINT, PUTC, EXIT
      case 0x52: pu = 1; break; // IN
      default: return end(5); // unknown opcode
    }
    if (pc + imm >= n) return end(9); // immediate cut off by the program's end
    steps++;
    if (sp < po) return end(2);
    if (sp - po + pu > 256) return end(3);
    const nx = pc + 1 + imm;
    pc = nx;

    switch (op) {
      case 0x00: return end(0); // HALT
      case 0x01: D[sp++] = (p[nx - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 0x02: // PUSH32, little-endian signed
        D[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
        break;
      case 0x03: sp--; break; // POP
      case 0x04: D[sp] = D[sp - 1]; sp++; break; // DUP
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; } // SWAP
      case 0x06: D[sp] = D[sp - 2]; sp++; break; // OVER
      case 0x07: { // ROT: (a b c -- b c a)
        const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a;
        break;
      }
      case 0x17: D[sp - 1] = (-D[sp - 1]) | 0; break; // NEG, wraps at INT_MIN
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break; // NOT
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
      case 0x16: case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d:
      case 0x1e: case 0x20: case 0x21: case 0x22: {
        const b = D[sp - 1], a = D[sp - 2];
        let r;
        if (op === 0x10) r = (a + b) | 0; // ADD, wraps
        else if (op === 0x11) r = (a - b) | 0; // SUB, wraps
        else if (op === 0x12) r = Math.imul(a, b); // MUL, low 32 bits exactly
        else if (op === 0x13) { // DIV, truncated toward zero
          if (b === 0) return end(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) { // MOD, sign of the dividend
          if (b === 0) return end(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) { // DIVU, unsigned
          if (b === 0) return end(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) { // MODU, unsigned
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31); // SHL
        else if (op === 0x1d) r = a >> (b & 31); // SHR, arithmetic
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0; // SHRU, logical
        else if (op === 0x20) r = a === b ? 1 : 0; // EQ
        else if (op === 0x21) r = a < b ? 1 : 0; // LT, signed
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU, unsigned
        sp -= 2; D[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: { // JMP, JZ, JNZ
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16; // signed offset
        if (op === 0x30) pc = nx + rel;
        else { const v = D[--sp]; if ((op === 0x31) === (v === 0)) pc = nx + rel; }
        break;
      }
      case 0x33: // CALL: push the next address, jump to the unsigned target
        if (cp === 64) return end(7);
        C[cp++] = nx; pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34: // RET
        if (cp === 0) return end(8);
        pc = C[--cp];
        break;
      case 0x40: { // LOAD
        const a = D[sp - 1];
        if (a < 0 || a > 255) return end(6);
        D[sp - 1] = M[a];
        break;
      }
      case 0x41: { // STORE: (v addr --), top of stack is the address
        const a = D[sp - 1], v = D[sp - 2];
        if (a < 0 || a > 255) return end(6);
        sp -= 2; M[a] = v;
        break;
      }
      case 0x50: { // PRINT: decimal ASCII, no newline; trap 11 writes nothing
        const s = String(D[--sp]);
        if (ol + s.length > 65536) return end(11);
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 0x51: // PUTC: one byte, the low 8 bits
        if (ol + 1 > 65536) return end(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break; // IN, -1 at end
      case 0x53: return end(D[--sp] & 255); // EXIT with the low byte
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(
    new Uint8Array(readFileSync(join(I, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(I, id, 'input.bin'))),
  );
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.o);
  writeFileSync(join(O, id, 'exit.txt'), r.e + '\n');
}
