# Tiny Stack VM

An interpreter for make.fun's tiny-stack-vm-01 ISA (`generator/subject/ISA.md`
in the kit): wrapping 32-bit integers, a 256-value data stack, calls, 256 words
of memory, and every trap with its own exit code — exact `Math.imul`, unsigned
DIVU/MODU/LTU, `INT_MIN / -1`, shifts masked to 5 bits, PUSH8 sign extension,
stack/call/memory bounds, and the 1,000,000-step / 65,536-byte-output limits.

Run: `node main.ts` (Node 22; reads `/input/<id>/`, writes `/output/<id>/`).
No dependencies, no network, no clock reads — deterministic across runs.
