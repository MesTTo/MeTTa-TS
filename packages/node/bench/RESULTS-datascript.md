# MeTTaScript 2.0.1 RC versus DataScript

Status: **PROVISIONAL**. Every timing pass ran while the host had sustained storage contention. The ten preflights recorded 21 to 26 blocked tasks, 27,694,536 to 30,621,176 KiB of swap in use, 30% to 50% global I/O wait, and active swap input. CPU 15 was pinned for all measured processes, but its SMT sibling CPU 31 also showed I/O wait. The numbers below are measured observations from this host state. They are not clean release numbers.

## Verdict

The scoped claim that MeTTaScript is faster on declarative queries is **PASS, PROVISIONAL**. At both 12,000 and 120,000 records, under uniform and skew distributions, the release candidate won all 7 warm declarative workloads. It also won all 6 parse-inclusive rows.

An unqualified claim that the release candidate is faster than DataScript is false. The release candidate won 7 of 12 warm rows and 6 of 12 cold rows in every size and distribution. DataScript won all 5 warm direct-read rows. On cold first calls, DataScript also won reverse lookup through Datalog. The 120,000-record direct-read losses ranged from 1.05x to 155x on warm calls and from 9.17x to 196x on cold calls.

The direct losses match DataScript's specialized read paths. At 120,000 uniform records, entity-by-id took 0.0028 ms in DataScript and 0.0082 ms in the RC, a 2.94x DataScript win. DataScript's one-percent `index_range` seek took 0.016 ms against 2.454 ms, a 153x win. Cold reverse lookup through the indexed API took 0.171 ms against 33.45 ms, a 196x win. Cold reverse Datalog took 7.028 ms against 33.45 ms, a 4.76x DataScript win.

The RC changed the profile relative to 1.1.7. At 120,000 records it made the warm range query 728x to 805x faster, the two-hop join 567x to 589x faster, and count-all 1,000x to 1,005x faster. The older engine remained 1.62x to 1.63x faster on the warm triangle join and 1.43x to 1.46x faster on bulk build.

The 120,000-record declarative results are:

| distribution |  source | reverse |    group |    range |  two-hop |      count | triangle |
| ------------ | ------: | ------: | -------: | -------: | -------: | ---------: | -------: |
| uniform      | RC 608x | RC 252x | RC 4.00x | RC 22.1x | RC 56.7x | RC 42,808x | RC 2.48x |
| skew         | RC 601x | RC 255x | RC 3.96x | RC 22.4x | RC 52.9x | RC 42,343x | RC 2.55x |

## Identity

The candidate source is revision `e81e1adc8aa9a7f32082f590ba93f2b84266ebbf` on `release/2.0.1`. Each RC pass loaded:

- module: `/home/user/Dev/MeTTaLingo-rc/packages/core/dist/index.js`
- package marker: `@mettascript/core@2.0.0`
- module SHA-256: `6f374481a3f8fc418181b4b94ec0763a6d1f87c69780d8cde5ffc58f562d3994`

The package marker still says 2.0.0 because this measurement precedes the 2.0.1 manifest bump. The source revision and bundle digest identify the release candidate.

DataScript is 1.7.8. The loaded file was `node_modules/.pnpm/datascript@1.7.8/node_modules/datascript/datascript.js`, SHA-256 `01a39a35669d919f263f231dc0bae0d255d6365a2974c7aa333dada7c7bbc29e`.

The historical comparison used `@metta-ts/core@1.1.7` from `node_modules/.pnpm/@metta-ts+core@1.1.7/node_modules/@metta-ts/core/dist/index.js`, SHA-256 `fc83b47c7aa86eabb26e816ff786759e0b88d211753b16029fef1beda5074494`.

The comparison directory `/home/user/Dev/datascript-vs-metta-ts` is not a Git worktree. Its measured driver is identified by these hashes:

- `benchmark.mjs`: `64538960d26843e989ff38636293b07e6863139eaed3825b52151d5a5d2b7909`
- `package.json`: `bd83ca846516e784faf92f5269765e695457e1ded1dfa06cf70f8e8baeacbe36`
- `pnpm-lock.yaml`: `5212026d7444bf5dabce5482713a420f5c06e10873bc4877529f5dfff3025d65`

Before each RC timing pass, the driver printed the resolved module path, package name, version marker, and SHA-256 shown above. It rejected module identity changes between worker processes. All cross-engine canonical-result checks passed.

## Method

The driver generated 12,000 and 120,000 edge records. DataScript stored three datoms per record. Both uniform and skew distributions ran their complete workload sets.

Each table value for the RC or its paired DataScript run is the geometric mean of two engine-order passes:

- pass A ran DataScript first, then the release candidate;
- pass B ran the release candidate first, then DataScript.

Each engine used five isolated Node processes. The driver reported the minimum process-level result, while each worker measured adaptive repetitions and reported the median call time. Every process was pinned with `taskset -c 15`. The “A to B” column gives the two paired speedup ratios, so order sensitivity stays visible. Overall speedup is the ratio of the two geometric-mean times. Geometric means preserve the direction of paired performance ratios, following the ratio aggregation used by [SPEC CPU](https://www.spec.org/cpu2026/docs/overview.html). Reversing the two engine sweeps addresses the same system-state risk for which [Google Benchmark provides random interleaving](https://google.github.io/benchmark/user_guide.html).

The 1.1.7 column comes from a separate full five-process pass for each distribution with DataScript first. It is included to show the engine delta, but it did not receive a reversed-order companion pass.

“Direct” rows use DataScript's hand-written entity or index API. “Declarative” rows use DataScript Datalog. The MeTTaScript side uses the matching prepared query. Parse-inclusive rows make MeTTaScript parse on every call; DataScript `q` already reads its query string on every call. Cold rows include the first query call and its compilation or JIT cost.

The host was an ASUS TUF GAMING B850M-PLUS WIFI with one AMD Ryzen 9 9950X, 16 cores, 32 threads, 60 GiB RAM, and a 5,756 MHz reported maximum. CPU frequency policy was `performance`, boost was enabled, and CPU 15 sampled at 5,534 MHz during provenance capture. Software was Linux 7.0.0-27-generic, Node v22.22.1, and pnpm 11.2.2.

## Results

A ratio above 1x in the “A to B” column favors the release candidate. A ratio below 1x favors DataScript. Build and memory rows use the same lower-is-better rule.

### skew, 120,000 records

#### Build and memory

| metric                          | DataScript |  1.1.7 |     RC | RC vs DataScript, A to B | lower            | RC vs 1.1.7 |
| ------------------------------- | ---------: | -----: | -----: | -----------------------: | ---------------- | ----------: |
| bulk build, ms                  |      480.0 |  301.0 |  430.5 |           1.08x to 1.15x | RC 1.11x         | 1.1.7 1.43x |
| retained heap after build, MiB  |      48.80 |  131.0 |  36.52 |           1.34x to 1.34x | RC 1.34x         |    RC 3.59x |
| retained heap after points, MiB |      50.03 |  222.6 |  42.89 |           1.16x to 1.17x | RC 1.17x         |    RC 5.19x |
| retained heap after scans, MiB  |      50.26 |  516.8 |  55.03 |           0.91x to 0.91x | DataScript 1.09x |    RC 9.39x |
| peak process RSS, MiB           |     2453.5 | 2791.4 | 1937.2 |           1.22x to 1.32x | RC 1.27x         |    RC 1.44x |
| immutable batch insert, ms      |      164.2 |  27.04 |  18.72 |           8.68x to 8.86x | RC 8.77x         |    RC 1.44x |

#### Warm query medians

| workload                       | kind        | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner           | RC vs 1.1.7 |
| ------------------------------ | ----------- | ------------: | -------: | -----: | -----------------------: | ---------------- | ----------: |
| record by entity id            | direct      |        0.0028 |    0.035 | 0.0066 |           0.41x to 0.44x | DataScript 2.36x |    RC 5.23x |
| source lookup, indexed API     | direct      |        0.0100 |    0.022 |  0.013 |           0.74x to 0.76x | DataScript 1.33x |    RC 1.68x |
| source lookup, Datalog         | declarative |         7.945 |    0.022 |  0.013 |             591x to 610x | RC 601x          |    RC 1.68x |
| reverse lookup, indexed API    | direct      |        0.0074 |    0.019 |  0.013 |           0.56x to 0.57x | DataScript 1.77x |    RC 1.45x |
| reverse lookup, Datalog        | declarative |         3.354 |    0.019 |  0.013 |             249x to 261x | RC 255x          |    RC 1.45x |
| group lookup, indexed API      | direct      |         2.706 |    6.842 |  2.835 |           0.93x to 0.99x | DataScript 1.05x |    RC 2.41x |
| group lookup, Datalog          | declarative |         11.22 |    6.842 |  2.835 |           3.61x to 4.35x | RC 3.96x         |    RC 2.41x |
| one-percent range, indexed API | direct      |         0.016 |   1773.5 |  2.437 |           0.01x to 0.01x | DataScript 155x  |     RC 728x |
| one-percent range, Datalog     | declarative |         54.64 |   1773.5 |  2.437 |           21.9x to 22.9x | RC 22.4x         |     RC 728x |
| anchored two-hop join          | declarative |         15.66 |    168.0 |  0.296 |           51.1x to 54.8x | RC 52.9x         |     RC 567x |
| count all edges                | declarative |         118.2 |    2.789 | 0.0028 |       41,015x to 43,713x | RC 42,343x       |   RC 1,000x |
| triangle join count            | declarative |        3848.4 |    933.9 | 1508.6 |           2.51x to 2.59x | RC 2.55x         | 1.1.7 1.62x |

#### Cold first calls

| workload                       | kind        | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner           | RC vs 1.1.7 |
| ------------------------------ | ----------- | ------------: | -------: | -----: | -----------------------: | ---------------- | ----------: |
| record by entity id            | direct      |         0.919 |    7.611 |  39.24 |           0.02x to 0.02x | DataScript 42.7x | 1.1.7 5.16x |
| source lookup, indexed API     | direct      |         0.385 |    0.164 |  14.61 |           0.03x to 0.03x | DataScript 37.9x | 1.1.7 89.3x |
| source lookup, Datalog         | declarative |         30.53 |    0.164 |  14.61 |           2.05x to 2.13x | RC 2.09x         | 1.1.7 89.3x |
| reverse lookup, indexed API    | direct      |         0.173 |    0.212 |  31.67 |           0.01x to 0.01x | DataScript 183x  |  1.1.7 149x |
| reverse lookup, Datalog        | declarative |         7.160 |    0.212 |  31.67 |           0.22x to 0.23x | DataScript 4.42x |  1.1.7 149x |
| group lookup, indexed API      | direct      |         3.276 |    10.96 |  30.05 |           0.10x to 0.12x | DataScript 9.17x | 1.1.7 2.74x |
| group lookup, Datalog          | declarative |         43.70 |    10.96 |  30.05 |           1.39x to 1.52x | RC 1.45x         | 1.1.7 2.74x |
| one-percent range, indexed API | direct      |         0.279 |   2149.3 |  7.286 |           0.04x to 0.04x | DataScript 26.1x |     RC 295x |
| one-percent range, Datalog     | declarative |         124.6 |   2149.3 |  7.286 |           16.5x to 17.7x | RC 17.1x         |     RC 295x |
| anchored two-hop join          | declarative |         29.45 |    270.9 |  5.291 |           5.30x to 5.85x | RC 5.57x         |    RC 51.2x |
| count all edges                | declarative |         211.0 |    8.776 |  0.440 |             467x to 494x | RC 480x          |    RC 20.0x |
| triangle join count            | declarative |        4166.5 |   1213.9 | 1591.7 |           2.56x to 2.68x | RC 2.62x         | 1.1.7 1.31x |

#### Parse-inclusive query medians

| workload                   | kind            | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner     | RC vs 1.1.7 |
| -------------------------- | --------------- | ------------: | -------: | -----: | -----------------------: | ---------- | ----------: |
| source lookup, Datalog     | parse-inclusive |         7.945 |    0.075 |  0.018 |             432x to 439x | RC 436x    |    RC 4.10x |
| reverse lookup, Datalog    | parse-inclusive |         3.354 |    0.031 |  0.017 |             185x to 210x | RC 197x    |    RC 1.80x |
| group lookup, Datalog      | parse-inclusive |         11.22 |    7.751 |  2.698 |           3.77x to 4.59x | RC 4.16x   |    RC 2.87x |
| one-percent range, Datalog | parse-inclusive |         54.64 |   1990.9 |  2.413 |           21.6x to 23.8x | RC 22.6x   |     RC 825x |
| anchored two-hop join      | parse-inclusive |         15.66 |    259.2 |  0.168 |            85.8x to 101x | RC 93.1x   |   RC 1,542x |
| count all edges            | parse-inclusive |         118.2 |    2.645 | 0.0033 |       36,034x to 36,093x | RC 36,063x |     RC 807x |

### uniform, 120,000 records

#### Build and memory

| metric                          | DataScript |  1.1.7 |     RC | RC vs DataScript, A to B | lower            | RC vs 1.1.7 |
| ------------------------------- | ---------: | -----: | -----: | -----------------------: | ---------------- | ----------: |
| bulk build, ms                  |      500.2 |  303.2 |  441.9 |           1.13x to 1.14x | RC 1.13x         | 1.1.7 1.46x |
| retained heap after build, MiB  |      48.78 |  131.2 |  36.50 |           1.34x to 1.34x | RC 1.34x         |    RC 3.60x |
| retained heap after points, MiB |      49.87 |  222.7 |  43.22 |           1.15x to 1.15x | RC 1.15x         |    RC 5.15x |
| retained heap after scans, MiB  |      50.22 |  516.9 |  55.01 |           0.91x to 0.91x | DataScript 1.10x |    RC 9.40x |
| peak process RSS, MiB           |     2417.8 | 2790.3 | 2083.8 |           1.08x to 1.25x | RC 1.16x         |    RC 1.34x |
| immutable batch insert, ms      |      175.8 |  30.12 |  20.00 |           8.29x to 9.32x | RC 8.79x         |    RC 1.51x |

#### Warm query medians

| workload                       | kind        | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner           | RC vs 1.1.7 |
| ------------------------------ | ----------- | ------------: | -------: | -----: | -----------------------: | ---------------- | ----------: |
| record by entity id            | direct      |        0.0028 |    0.033 | 0.0082 |           0.31x to 0.38x | DataScript 2.94x |    RC 4.00x |
| source lookup, indexed API     | direct      |        0.0100 |    0.023 |  0.014 |           0.71x to 0.76x | DataScript 1.36x |    RC 1.68x |
| source lookup, Datalog         | declarative |         8.257 |    0.023 |  0.014 |             563x to 657x | RC 608x          |    RC 1.68x |
| reverse lookup, indexed API    | direct      |        0.0074 |    0.020 |  0.013 |           0.55x to 0.55x | DataScript 1.82x |    RC 1.47x |
| reverse lookup, Datalog        | declarative |         3.399 |    0.020 |  0.013 |             248x to 256x | RC 252x          |    RC 1.47x |
| group lookup, indexed API      | direct      |         2.098 |    5.357 |  2.242 |           0.90x to 0.97x | DataScript 1.07x |    RC 2.39x |
| group lookup, Datalog          | declarative |         8.956 |    5.357 |  2.242 |           3.78x to 4.22x | RC 4.00x         |    RC 2.39x |
| one-percent range, indexed API | direct      |         0.016 |   1976.0 |  2.454 |           0.01x to 0.01x | DataScript 153x  |     RC 805x |
| one-percent range, Datalog     | declarative |         54.18 |   1976.0 |  2.454 |           22.1x to 22.1x | RC 22.1x         |     RC 805x |
| anchored two-hop join          | declarative |         17.02 |    176.8 |  0.300 |           55.5x to 58.0x | RC 56.7x         |     RC 589x |
| count all edges                | declarative |         122.6 |    2.879 | 0.0029 |       41,151x to 44,532x | RC 42,808x       |   RC 1,005x |
| triangle join count            | declarative |        3721.3 |    922.6 | 1502.9 |           2.39x to 2.56x | RC 2.48x         | 1.1.7 1.63x |

#### Cold first calls

| workload                       | kind        | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner           | RC vs 1.1.7 |
| ------------------------------ | ----------- | ------------: | -------: | -----: | -----------------------: | ---------------- | ----------: |
| record by entity id            | direct      |         0.908 |    7.403 |  39.94 |           0.02x to 0.02x | DataScript 44.0x | 1.1.7 5.40x |
| source lookup, indexed API     | direct      |         0.398 |    0.160 |  14.41 |           0.03x to 0.03x | DataScript 36.2x | 1.1.7 90.0x |
| source lookup, Datalog         | declarative |         29.54 |    0.160 |  14.41 |           2.03x to 2.06x | RC 2.05x         | 1.1.7 90.0x |
| reverse lookup, indexed API    | direct      |         0.171 |    0.174 |  33.45 |           0.01x to 0.01x | DataScript 196x  |  1.1.7 192x |
| reverse lookup, Datalog        | declarative |         7.028 |    0.174 |  33.45 |           0.21x to 0.21x | DataScript 4.76x |  1.1.7 192x |
| group lookup, indexed API      | direct      |         2.789 |    9.729 |  36.17 |           0.07x to 0.08x | DataScript 13.0x | 1.1.7 3.72x |
| group lookup, Datalog          | declarative |         43.07 |    9.729 |  36.17 |           1.05x to 1.35x | RC 1.19x         | 1.1.7 3.72x |
| one-percent range, indexed API | direct      |         0.313 |   2217.6 |  7.463 |           0.04x to 0.05x | DataScript 23.9x |     RC 297x |
| one-percent range, Datalog     | declarative |         126.7 |   2217.6 |  7.463 |           16.6x to 17.4x | RC 17.0x         |     RC 297x |
| anchored two-hop join          | declarative |         29.86 |    288.3 |  4.984 |           5.50x to 6.53x | RC 5.99x         |    RC 57.9x |
| count all edges                | declarative |         213.1 |    6.274 |  0.455 |             464x to 473x | RC 468x          |    RC 13.8x |
| triangle join count            | declarative |        4136.5 |   1833.5 | 1581.9 |           2.59x to 2.64x | RC 2.61x         |    RC 1.16x |

#### Parse-inclusive query medians

| workload                   | kind            | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner     | RC vs 1.1.7 |
| -------------------------- | --------------- | ------------: | -------: | -----: | -----------------------: | ---------- | ----------: |
| source lookup, Datalog     | parse-inclusive |         8.257 |    0.157 |  0.018 |             438x to 462x | RC 449x    |    RC 8.53x |
| reverse lookup, Datalog    | parse-inclusive |         3.399 |    0.029 |  0.017 |             195x to 196x | RC 195x    |    RC 1.65x |
| group lookup, Datalog      | parse-inclusive |         8.956 |    6.034 |  2.062 |           4.28x to 4.41x | RC 4.34x   |    RC 2.93x |
| one-percent range, Datalog | parse-inclusive |         54.18 |   2005.1 |  2.444 |           22.0x to 22.4x | RC 22.2x   |     RC 820x |
| anchored two-hop join      | parse-inclusive |         17.02 |    271.9 |  0.171 |            97.8x to 101x | RC 99.5x   |   RC 1,590x |
| count all edges            | parse-inclusive |         122.6 |    2.782 | 0.0032 |       38,103x to 38,446x | RC 38,274x |     RC 868x |

### skew, 12,000 records

#### Build and memory

| metric                          | DataScript | 1.1.7 |    RC | RC vs DataScript, A to B | lower            | RC vs 1.1.7 |
| ------------------------------- | ---------: | ----: | ----: | -----------------------: | ---------------- | ----------: |
| bulk build, ms                  |      101.0 | 44.86 | 121.4 |           0.81x to 0.86x | DataScript 1.20x | 1.1.7 2.71x |
| retained heap after build, MiB  |      5.274 | 13.53 | 4.449 |           1.18x to 1.19x | RC 1.19x         |    RC 3.04x |
| retained heap after points, MiB |      6.108 | 23.82 | 5.298 |           1.15x to 1.16x | RC 1.15x         |    RC 4.50x |
| retained heap after scans, MiB  |      6.880 | 53.59 | 7.361 |           0.93x to 0.94x | DataScript 1.07x |    RC 7.28x |
| peak process RSS, MiB           |      375.4 | 569.1 | 412.3 |           0.90x to 0.92x | DataScript 1.10x |    RC 1.38x |
| immutable batch insert, ms      |      17.24 | 4.668 | 2.026 |           6.11x to 11.9x | RC 8.51x         |    RC 2.30x |

#### Warm query medians

| workload                       | kind        | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner           | RC vs 1.1.7 |
| ------------------------------ | ----------- | ------------: | -------: | -----: | -----------------------: | ---------------- | ----------: |
| record by entity id            | direct      |        0.0027 |    0.036 | 0.0086 |           0.28x to 0.37x | DataScript 3.15x |    RC 4.18x |
| source lookup, indexed API     | direct      |        0.0095 |    0.022 |  0.013 |           0.70x to 0.73x | DataScript 1.40x |    RC 1.61x |
| source lookup, Datalog         | declarative |         1.205 |    0.022 |  0.013 |           89.3x to 91.4x | RC 90.4x         |    RC 1.61x |
| reverse lookup, indexed API    | direct      |        0.0071 |    0.018 |  0.013 |           0.52x to 0.53x | DataScript 1.91x |    RC 1.36x |
| reverse lookup, Datalog        | declarative |         0.429 |    0.018 |  0.013 |           31.4x to 32.2x | RC 31.8x         |    RC 1.36x |
| group lookup, indexed API      | direct      |         0.268 |    0.472 |  0.272 |           0.98x to 0.99x | DataScript 1.01x |    RC 1.73x |
| group lookup, Datalog          | declarative |         1.020 |    0.472 |  0.272 |           3.57x to 3.93x | RC 3.75x         |    RC 1.73x |
| one-percent range, indexed API | direct      |        0.0025 |    155.8 |  0.197 |           0.01x to 0.01x | DataScript 78.6x |     RC 792x |
| one-percent range, Datalog     | declarative |         4.398 |    155.8 |  0.197 |           21.5x to 23.2x | RC 22.3x         |     RC 792x |
| anchored two-hop join          | declarative |         1.960 |    14.01 |  0.308 |           6.07x to 6.68x | RC 6.36x         |    RC 45.5x |
| count all edges                | declarative |         5.566 |    0.234 | 0.0026 |         2,034x to 2,174x | RC 2,103x        |    RC 88.3x |
| triangle join count            | declarative |         232.9 |    72.05 |  133.8 |           1.68x to 1.81x | RC 1.74x         | 1.1.7 1.86x |

#### Cold first calls

| workload                       | kind        | DataScript ms | 1.1.7 ms | RC ms | RC vs DataScript, A to B | winner           | RC vs 1.1.7 |
| ------------------------------ | ----------- | ------------: | -------: | ----: | -----------------------: | ---------------- | ----------: |
| record by entity id            | direct      |         0.756 |    3.682 | 11.40 |           0.06x to 0.07x | DataScript 15.1x | 1.1.7 3.10x |
| source lookup, indexed API     | direct      |         0.371 |    0.162 | 1.622 |           0.21x to 0.25x | DataScript 4.37x | 1.1.7 10.0x |
| source lookup, Datalog         | declarative |         12.47 |    0.162 | 1.622 |           6.52x to 9.07x | RC 7.69x         | 1.1.7 10.0x |
| reverse lookup, indexed API    | direct      |         0.147 |    0.210 | 7.694 |           0.02x to 0.02x | DataScript 52.4x | 1.1.7 36.7x |
| reverse lookup, Datalog        | declarative |         2.351 |    0.210 | 7.694 |           0.21x to 0.44x | DataScript 3.27x | 1.1.7 36.7x |
| group lookup, indexed API      | direct      |         0.451 |    0.825 | 5.011 |           0.06x to 0.13x | DataScript 11.1x | 1.1.7 6.07x |
| group lookup, Datalog          | declarative |         6.869 |    0.825 | 5.011 |           0.93x to 2.03x | RC 1.37x         | 1.1.7 6.07x |
| one-percent range, indexed API | direct      |         0.186 |    332.0 | 1.549 |           0.11x to 0.13x | DataScript 8.35x |     RC 214x |
| one-percent range, Datalog     | declarative |         35.88 |    332.0 | 1.549 |           22.5x to 23.8x | RC 23.2x         |     RC 214x |
| anchored two-hop join          | declarative |         9.712 |    30.90 | 4.600 |           1.88x to 2.38x | RC 2.11x         |    RC 6.72x |
| count all edges                | declarative |         52.54 |    1.944 | 0.417 |             118x to 135x | RC 126x          |    RC 4.66x |
| triangle join count            | declarative |         365.1 |    206.0 | 223.6 |           1.60x to 1.66x | RC 1.63x         | 1.1.7 1.09x |

#### Parse-inclusive query medians

| workload                   | kind            | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner    | RC vs 1.1.7 |
| -------------------------- | --------------- | ------------: | -------: | -----: | -----------------------: | --------- | ----------: |
| source lookup, Datalog     | parse-inclusive |         1.205 |    0.038 |  0.017 |           67.1x to 72.4x | RC 69.7x  |    RC 2.19x |
| reverse lookup, Datalog    | parse-inclusive |         0.429 |    0.025 |  0.016 |           25.4x to 27.2x | RC 26.3x  |    RC 1.54x |
| group lookup, Datalog      | parse-inclusive |         1.020 |    0.660 |  0.269 |           3.59x to 4.00x | RC 3.79x  |    RC 2.45x |
| one-percent range, Datalog | parse-inclusive |         4.398 |    165.9 |  0.206 |           21.1x to 21.7x | RC 21.4x  |     RC 807x |
| anchored two-hop join      | parse-inclusive |         1.960 |    21.64 |  0.166 |           11.2x to 12.4x | RC 11.8x  |     RC 130x |
| count all edges            | parse-inclusive |         5.566 |    0.238 | 0.0032 |         1,743x to 1,752x | RC 1,747x |    RC 74.7x |

### uniform, 12,000 records

#### Build and memory

| metric                          | DataScript | 1.1.7 |    RC | RC vs DataScript, A to B | lower            | RC vs 1.1.7 |
| ------------------------------- | ---------: | ----: | ----: | -----------------------: | ---------------- | ----------: |
| bulk build, ms                  |      101.6 | 49.16 | 122.6 |           0.81x to 0.85x | DataScript 1.21x | 1.1.7 2.49x |
| retained heap after build, MiB  |      5.261 | 13.55 | 4.445 |           1.18x to 1.19x | RC 1.18x         |    RC 3.05x |
| retained heap after points, MiB |      6.078 | 23.80 | 5.292 |           1.14x to 1.15x | RC 1.15x         |    RC 4.50x |
| retained heap after scans, MiB  |      6.914 | 53.57 | 7.336 |           0.94x to 0.95x | DataScript 1.06x |    RC 7.30x |
| peak process RSS, MiB           |      401.4 | 587.1 | 408.9 |           0.97x to 1.00x | DataScript 1.02x |    RC 1.44x |
| immutable batch insert, ms      |      17.69 | 4.658 | 2.011 |           8.29x to 9.33x | RC 8.79x         |    RC 2.32x |

#### Warm query medians

| workload                       | kind        | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner           | RC vs 1.1.7 |
| ------------------------------ | ----------- | ------------: | -------: | -----: | -----------------------: | ---------------- | ----------: |
| record by entity id            | direct      |        0.0028 |    0.034 | 0.0074 |           0.37x to 0.39x | DataScript 2.64x |    RC 4.59x |
| source lookup, indexed API     | direct      |        0.0096 |    0.022 |  0.014 |           0.70x to 0.71x | DataScript 1.43x |    RC 1.65x |
| source lookup, Datalog         | declarative |         1.171 |    0.022 |  0.014 |           84.5x to 87.3x | RC 85.9x         |    RC 1.65x |
| reverse lookup, indexed API    | direct      |        0.0070 |    0.019 |  0.013 |           0.53x to 0.54x | DataScript 1.86x |    RC 1.43x |
| reverse lookup, Datalog        | declarative |         0.438 |    0.019 |  0.013 |           33.4x to 33.5x | RC 33.4x         |    RC 1.43x |
| group lookup, indexed API      | direct      |         0.199 |    0.356 |  0.202 |           0.97x to 1.01x | DataScript 1.01x |    RC 1.76x |
| group lookup, Datalog          | declarative |         0.890 |    0.356 |  0.202 |           4.39x to 4.43x | RC 4.41x         |    RC 1.76x |
| one-percent range, indexed API | direct      |        0.0024 |    165.8 |  0.201 |           0.01x to 0.01x | DataScript 84.1x |     RC 824x |
| one-percent range, Datalog     | declarative |         4.494 |    165.8 |  0.201 |           22.1x to 22.6x | RC 22.3x         |     RC 824x |
| anchored two-hop join          | declarative |         1.986 |    14.27 |  0.305 |           6.26x to 6.76x | RC 6.50x         |    RC 46.7x |
| count all edges                | declarative |         5.609 |    0.242 | 0.0028 |         1,938x to 2,139x | RC 2,036x        |    RC 88.0x |
| triangle join count            | declarative |         239.3 |    75.55 |  145.8 |           1.60x to 1.69x | RC 1.64x         | 1.1.7 1.93x |

#### Cold first calls

| workload                       | kind        | DataScript ms | 1.1.7 ms | RC ms | RC vs DataScript, A to B | winner           | RC vs 1.1.7 |
| ------------------------------ | ----------- | ------------: | -------: | ----: | -----------------------: | ---------------- | ----------: |
| record by entity id            | direct      |         0.768 |    3.801 | 11.80 |           0.06x to 0.07x | DataScript 15.4x | 1.1.7 3.11x |
| source lookup, indexed API     | direct      |         0.388 |    0.166 | 1.750 |           0.21x to 0.23x | DataScript 4.52x | 1.1.7 10.5x |
| source lookup, Datalog         | declarative |         14.29 |    0.166 | 1.750 |           7.65x to 8.71x | RC 8.17x         | 1.1.7 10.5x |
| reverse lookup, indexed API    | direct      |         0.147 |    0.191 | 7.663 |           0.02x to 0.02x | DataScript 52.0x | 1.1.7 40.1x |
| reverse lookup, Datalog        | declarative |         4.203 |    0.191 | 7.663 |           0.53x to 0.57x | DataScript 1.82x | 1.1.7 40.1x |
| group lookup, indexed API      | direct      |         0.405 |    0.727 | 2.951 |           0.10x to 0.20x | DataScript 7.28x | 1.1.7 4.06x |
| group lookup, Datalog          | declarative |         5.530 |    0.727 | 2.951 |           1.32x to 2.67x | RC 1.87x         | 1.1.7 4.06x |
| one-percent range, indexed API | direct      |         0.191 |    353.8 | 1.609 |           0.11x to 0.12x | DataScript 8.42x |     RC 220x |
| one-percent range, Datalog     | declarative |         35.99 |    353.8 | 1.609 |           21.3x to 23.5x | RC 22.4x         |     RC 220x |
| anchored two-hop join          | declarative |         8.655 |    32.83 | 4.713 |           1.82x to 1.86x | RC 1.84x         |    RC 6.97x |
| count all edges                | declarative |         58.04 |    1.956 | 0.444 |             125x to 136x | RC 131x          |    RC 4.41x |
| triangle join count            | declarative |         388.2 |    191.7 | 226.8 |           1.70x to 1.72x | RC 1.71x         | 1.1.7 1.18x |

#### Parse-inclusive query medians

| workload                   | kind            | DataScript ms | 1.1.7 ms |  RC ms | RC vs DataScript, A to B | winner    | RC vs 1.1.7 |
| -------------------------- | --------------- | ------------: | -------: | -----: | -----------------------: | --------- | ----------: |
| source lookup, Datalog     | parse-inclusive |         1.171 |    0.040 |  0.018 |           64.1x to 64.3x | RC 64.2x  |    RC 2.19x |
| reverse lookup, Datalog    | parse-inclusive |         0.438 |    0.026 |  0.017 |           25.8x to 26.0x | RC 25.9x  |    RC 1.55x |
| group lookup, Datalog      | parse-inclusive |         0.890 |    0.509 |  0.204 |           4.28x to 4.45x | RC 4.37x  |    RC 2.50x |
| one-percent range, Datalog | parse-inclusive |         4.494 |    166.3 |  0.208 |           21.6x to 21.7x | RC 21.6x  |     RC 800x |
| anchored two-hop join      | parse-inclusive |         1.986 |    23.36 |  0.166 |           11.6x to 12.3x | RC 12.0x  |     RC 141x |
| count all edges            | parse-inclusive |         5.609 |    0.238 | 0.0033 |         1,683x to 1,759x | RC 1,721x |    RC 73.2x |

## Clean rerun

Run these commands only when `mpstat` shows CPUs 15 and 31 idle, `vmstat` shows zero blocked tasks and no swap input or output, and no other benchmark occupies the physical core. The commands require the measured `benchmark.mjs` identified above.

```bash
set -euo pipefail
cd /home/user/Dev/datascript-vs-metta-ts
pnpm install --frozen-lockfile

LC_ALL=C mpstat -P 15,31 1 5
LC_ALL=C vmstat 1 3
env BENCH_RUNS=5 BENCH_SIZES=12000,120000 BENCH_PROCESS_AGGREGATE=min \
  BENCH_DIST=uniform BENCH_ENGINE_ORDER=datascript,metta \
  BENCH_JSON_OUT=/home/user/Dev/MeTTaLingo-rc/ai-tmp/release-gate-2.0.1/clean-datascript-rc-uniform-a.json \
  METTA_CORE_ENTRY=/home/user/Dev/MeTTaLingo-rc/packages/core/dist/index.js \
  METTA_CORE_PACKAGE_JSON=/home/user/Dev/MeTTaLingo-rc/packages/core/package.json \
  taskset -c 15 pnpm bench

LC_ALL=C mpstat -P 15,31 1 5
LC_ALL=C vmstat 1 3
env BENCH_RUNS=5 BENCH_SIZES=12000,120000 BENCH_PROCESS_AGGREGATE=min \
  BENCH_DIST=uniform BENCH_ENGINE_ORDER=metta,datascript \
  BENCH_JSON_OUT=/home/user/Dev/MeTTaLingo-rc/ai-tmp/release-gate-2.0.1/clean-datascript-rc-uniform-b.json \
  METTA_CORE_ENTRY=/home/user/Dev/MeTTaLingo-rc/packages/core/dist/index.js \
  METTA_CORE_PACKAGE_JSON=/home/user/Dev/MeTTaLingo-rc/packages/core/package.json \
  taskset -c 15 pnpm bench

LC_ALL=C mpstat -P 15,31 1 5
LC_ALL=C vmstat 1 3
env BENCH_RUNS=5 BENCH_SIZES=12000,120000 BENCH_PROCESS_AGGREGATE=min \
  BENCH_DIST=skew BENCH_ENGINE_ORDER=datascript,metta \
  BENCH_JSON_OUT=/home/user/Dev/MeTTaLingo-rc/ai-tmp/release-gate-2.0.1/clean-datascript-rc-skew-a.json \
  METTA_CORE_ENTRY=/home/user/Dev/MeTTaLingo-rc/packages/core/dist/index.js \
  METTA_CORE_PACKAGE_JSON=/home/user/Dev/MeTTaLingo-rc/packages/core/package.json \
  taskset -c 15 pnpm bench

LC_ALL=C mpstat -P 15,31 1 5
LC_ALL=C vmstat 1 3
env BENCH_RUNS=5 BENCH_SIZES=12000,120000 BENCH_PROCESS_AGGREGATE=min \
  BENCH_DIST=skew BENCH_ENGINE_ORDER=metta,datascript \
  BENCH_JSON_OUT=/home/user/Dev/MeTTaLingo-rc/ai-tmp/release-gate-2.0.1/clean-datascript-rc-skew-b.json \
  METTA_CORE_ENTRY=/home/user/Dev/MeTTaLingo-rc/packages/core/dist/index.js \
  METTA_CORE_PACKAGE_JSON=/home/user/Dev/MeTTaLingo-rc/packages/core/package.json \
  taskset -c 15 pnpm bench

LC_ALL=C mpstat -P 15,31 1 5
LC_ALL=C vmstat 1 3
env BENCH_RUNS=5 BENCH_SIZES=12000,120000 BENCH_PROCESS_AGGREGATE=min \
  BENCH_DIST=uniform BENCH_ENGINE_ORDER=datascript,metta \
  BENCH_JSON_OUT=/home/user/Dev/MeTTaLingo-rc/ai-tmp/release-gate-2.0.1/clean-datascript-117-uniform.json \
  taskset -c 15 pnpm bench

LC_ALL=C mpstat -P 15,31 1 5
LC_ALL=C vmstat 1 3
env BENCH_RUNS=5 BENCH_SIZES=12000,120000 BENCH_PROCESS_AGGREGATE=min \
  BENCH_DIST=skew BENCH_ENGINE_ORDER=datascript,metta \
  BENCH_JSON_OUT=/home/user/Dev/MeTTaLingo-rc/ai-tmp/release-gate-2.0.1/clean-datascript-117-skew.json \
  taskset -c 15 pnpm bench
```

The local raw JSON and preflight logs are under `ai-tmp/release-gate-2.0.1/`.
