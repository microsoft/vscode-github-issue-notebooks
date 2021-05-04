/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/


import { h, render } from 'preact';
import { AllItems } from './renderer';
import './renderer.css';

const api = acquireNotebookRendererApi('github-issues');

api.onDidCreateOutput(event => {
	render(<AllItems items={Array.isArray(event.value) ? event.value : (event.value as any).items} />, event.element);
});
