/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const incremental = process.argv.includes('--watch');

(async function () {

	// extension
	const buildExtension = await esbuild.build({
		incremental,
		bundle: true,
		entryPoints: ['src/extension/extension.ts'],
		tsconfig: 'src/extension/tsconfig.json',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		format: 'cjs',
		platform: 'node',
		target: ['node12.18'],
		sourcemap: true,
		minify: false // AbortSignal-module has issues...
	});

	// renderer
	const buildRenderer = await esbuild.build({
		incremental,
		bundle: true,
		entryPoints: ['src/renderer/index.tsx'],
		tsconfig: 'src/renderer/tsconfig.json',
		outfile: 'dist/renderer.js',
		format: 'iife',
		platform: 'browser',
		sourcemap: true,
		minify: true,
	});


	if (incremental) {
		fs.watch(path.join(__dirname, 'src'), { recursive: true }, async function () {
			await buildExtension.rebuild().catch(err => console.error(err));
			await buildRenderer.rebuild().catch(err => console.error(err));
		});
	}
})();
