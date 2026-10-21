import { defineConfig } from 'tsdown';

export default defineConfig([
    {
        entry: { index: 'src/index.ts', browser: 'src/browser.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        clean: true,
        sourcemap: true,
        target: 'es2022',
    },
    {
        // One file for a plain <script> tag: window.StakPass.init(...).
        entry: { stakpass: 'src/global.ts' },
        format: ['iife'],
        globalName: 'StakPassSdk',
        minify: true,
        sourcemap: true,
        target: 'es2020',
        dts: false,
        clean: false,
    },
]);
