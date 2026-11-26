// Type-check only. Bun has a global BodyInit at run time, but bun-types only declares it when the DOM lib is
// loaded, and the DOM lib's fetch types don't match Bun's. railwayUp.ts must stay byte-identical to
// server/railwayUp.ts, which uses the bare name, so give it one here.
type BodyInit = import("bun").BodyInit;
