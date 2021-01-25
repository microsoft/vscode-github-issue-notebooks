/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/


import { h, render } from 'preact';
import { AllItems } from './renderer';
import './renderer.css'; // only here for the bundler to pick it up

declare const scriptUrl: string;
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = scriptUrl.split('/').slice(0, -1).concat('renderer.css').join('/');
document.head.appendChild(link);

const api = acquireNotebookRendererApi('github-issues');

api.onDidCreateOutput(event => {
	const data = event.output.data[event.mimeType];
	render(<AllItems items={Array.isArray(data) ? data : data.items} />, event.element);
});
