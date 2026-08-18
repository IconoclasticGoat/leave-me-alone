import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Allowlist, not denylist. Vitest's default pattern globs the whole tree
    // and does not read .gitignore, so it collects test files from git-ignored
    // directories too — notably `.claude/worktrees/<name>/test/`, which holds a
    // full second copy of this repo and silently doubles the reported count.
    // Naming the one directory our tests live in cannot drift the same way.
    include: ['test/**/*.test.js'],
  },
});