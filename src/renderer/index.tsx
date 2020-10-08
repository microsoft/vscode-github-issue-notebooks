/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { h, render } from 'preact';
import { AllItems } from './renderer';
import './style.css';

const api = acquireNotebookRendererApi('github-issues');

api.onDidCreateOutput(event => {
	const data = event.output.data[event.mimeType];
	render(<AllItems items={Array.isArray(data) ? data : data.items} />, event.element);
});
