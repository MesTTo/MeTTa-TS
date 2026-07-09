// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function createSampleRepo(origin: string): void {
  mkdirSync(origin);
  writeFileSync(join(origin, "sample-lib.metta"), "(= (sample-lib-answer) 42)\n");
  execFileSync("git", ["-C", origin, "init"], { stdio: "ignore" });
  execFileSync("git", ["-C", origin, "config", "user.name", "MesTTo"], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", origin, "config", "user.email", "a.mesto@student.unsw.edu.au"], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", origin, "add", "sample-lib.metta"], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", origin, "commit", "-m", "Add sample lib"], {
    stdio: "ignore",
  });
}
