<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# @metta-ts/libraries

`@metta-ts/libraries` packages the pure MeTTa standard libraries for MeTTa TS.
Importing the package registers the modules with `@metta-ts/core`, so programs
can load them with `(import! &self <name>)`.

```ts
import "@metta-ts/libraries";
import { runProgram } from "@metta-ts/core";

const out = runProgram(`
  !(import! &self vector)
  !(dot (1.0 2.0 3.0) (4.0 5.0 6.0))
`);
```

The package currently includes `vector`, `roman`, `combinatorics`, `patrick`,
`datastructures`, `spaces`, `nars`, and `pln`. The native host modules remain
in `@metta-ts/core`.
