# Tiny Stack VM

A from-spec interpreter for make.fun's tiny-stack-vm-01 ISA (kit's
`generator/subject/ISA.md`): wrapping 32-bit integers, a 256-value stack,
branches/calls, 256 words of memory, and all ten traps with their exact exit
codes — exact `Math.imul`, unsigned DIVU/MODU/LTU, `INT_MIN / -1`, shifts
masked to 5 bits, PUSH8 sign extension, stack/call/memory bounds, the
1,000,000-step and 65,536-byte-output limits.

Run: `node main.ts` (Node 22; reads `/input/<id>/`, writes `/output/<id>/`).
No dependencies, no network, no clock reads — deterministic across runs.
