/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const esbuild = require('esbuild');

// extension
esbuild.build({
	bundle: true,
	entryPoints: ['src/extension/extension.ts'],
	tsconfig: 'src/extension/tsconfig.json',
	outfile: 'dist/extension.js',
	external: ['vscode'],
	format: 'cjs',
	platform: 'node',
	sourcemap: true,
	minify: false // AbortSignal-module has issues...
});

// renderer
esbuild.build({
	bundle: true,
	entryPoints: ['src/renderer/index.tsx'],
	tsconfig: 'src/renderer/tsconfig.json',
	outfile: 'dist/renderer.js',
	format: 'iife',
	platform: 'browser',
	sourcemap: true,
	minify: true,
});
