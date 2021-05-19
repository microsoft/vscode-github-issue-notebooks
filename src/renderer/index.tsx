/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { h, render } from 'preact';
import { ActivationFunction } from 'vscode-notebook-renderer';
import { AllItems } from './renderer';
import './renderer.css';

export const activate: ActivationFunction = () => ({
	renderCell(_id, { value, element }) {
		render(<AllItems items={Array.isArray(value) ? value : (value as any).items} />, element);
	},
});
