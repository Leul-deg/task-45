module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleFileExtensions: ["ts", "js"],
  setupFiles: ["<rootDir>/tests/setup/env.ts"],
  globalTeardown: "<rootDir>/tests/setup/jestGlobalTeardown.ts",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/index.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 60,
      functions: 60,
      branches: 50,
    },
  },
};
