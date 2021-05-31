/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const path = require('path');

/**@type {import('webpack').Configuration}*/
const config = {
	entry: './src/extension/extension.ts',
	devtool: 'source-map',
	externals: {
		vscode: 'commonjs vscode',
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader',
						options: {
							configFile: path.resolve(__dirname, './src/extension/tsconfig.json'),
							projectReferences: true,
							compilerOptions: {
								module: 'esnext',
							},
						},
					},
				],
			},
		],
	},
};

const nodeConfig = {
	...config,
	target: 'node',
	output: { // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
		path: path.resolve(__dirname, 'dist'),
		filename: 'extension-node.js',
		libraryTarget: "commonjs2",
		devtoolModuleFilenameTemplate: "../[resource-path]",
	}
};

const webConfig = {
	...config,
	target: 'webworker',
	output: { // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
		path: path.resolve(__dirname, 'dist'),
		filename: 'extension-web.js',
		libraryTarget: "commonjs2",
		devtoolModuleFilenameTemplate: "../[resource-path]",
	}
};

const rendererConfig = {
	...config,
	entry: './src/renderer/index.tsx',
	output: {
		path: path.resolve(__dirname, 'dist'),
		filename: 'renderer.js',
		libraryTarget: 'module',
	},
	resolve: {
		extensions: ['.ts', '.tsx', '.css'],
	},
	experiments: {
		outputModule: true,
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader',
						options: {
							configFile: path.resolve(__dirname, './src/renderer/tsconfig.json'),
							projectReferences: true,
							compilerOptions: {
								module: 'esnext',
							},
						},
					},
				],
			},
			{
				test: /\.css$/i,
				use: ['raw-loader'],
			},
		],
	}
};

module.exports = [nodeConfig, webConfig, rendererConfig];
