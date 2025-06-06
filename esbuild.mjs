#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

// Build for Node.js (ESM format)
const buildNode = async () => {
  try {
    const context = await esbuild.context({
      entryPoints: ['./src/extension/extension.ts'],
      bundle: true,
      external: ['vscode'],
      outfile: './dist/extension-node.js',
      platform: 'neutral',
      format: 'esm', // ESM output for Node.js
      sourcemap: true,
      minify: minify,
      target: ['node22'],
    });

    if (watch) {
      await context.watch();
      console.log('Watching for changes in Node.js build...');
    } else {
      await context.rebuild();
      await context.dispose();
    }
  } catch (err) {
    console.error('Error building Node.js bundle:', err);
    process.exit(1);
  }
};

// Build for web (CommonJS format)
const buildWeb = async () => {
  try {
    const context = await esbuild.context({
      entryPoints: ['./src/extension/extension.ts'],
      bundle: true,
      external: ['vscode'],
      outfile: './dist/extension-web.cjs',
      platform: 'browser',
      format: 'cjs', // CommonJS for web (specifically for vscode-module import)
      sourcemap: true,
      minify: minify,
      target: ['es2020'],
    });

    if (watch) {
      await context.watch();
      console.log('Watching for changes in Web build...');
    } else {
      await context.rebuild();
      await context.dispose();
    }
  } catch (err) {
    console.error('Error building Web bundle:', err);
    process.exit(1);
  }
};

// Build for renderer (ESM format for browser)
const buildRenderer = async () => {
  try {
    const context = await esbuild.context({
      entryPoints: ['./src/renderer/index.tsx'],
      bundle: true,
      outfile: './dist/renderer.js',
      platform: 'browser',
      format: 'esm', // ESM for browser renderer
      sourcemap: true,
      minify: minify,
      target: ['es2020'],
      loader: {
        '.css': 'text', // Use text loader for CSS files
      },
      jsx: 'automatic',
      jsxFactory: 'h', // Use Preact's h function
      jsxFragment: 'Fragment',
    });

    if (watch) {
      await context.watch();
      console.log('Watching for changes in Renderer build...');
    } else {
      await context.rebuild();
      await context.dispose();
    }
  } catch (err) {
    console.error('Error building Renderer bundle:', err);
    process.exit(1);
  }
};

// Create dist directory if it doesn't exist
if (!fs.existsSync(path.join(__dirname, 'dist'))) {
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
}

// Run all builds
Promise.all([buildNode(), buildWeb(), buildRenderer()])
  .then(() => {
    if (!watch) {
      console.log('All builds completed successfully!');
    }
  })
  .catch((err) => {
    console.error('Error during build process:', err);
    process.exit(1);
  });
